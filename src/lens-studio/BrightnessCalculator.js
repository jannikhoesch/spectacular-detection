/**
 * Brightness Calculator for Lens Studio (Using ProceduralTextureProvider)
 * Calculates WCAG Relative Luminance in real-time and sends to Python backend
 * 
 * Uses ProceduralTextureProvider.getPixels() to read pixel values from camera texture
 * This is the recommended way to access pixel data in Lens Studio
 * 
 * IMPORTANT: To enable HTTP requests, add InternetModule to your project:
 * - Resources > Import > Import from Library > Search "InternetModule"
 * 
 * @input Component.Text textComponent
 * @input Asset.Texture deviceCameraTexture  // Device Camera Texture (from Resources)
 * @input bool showPercentage = false
 * @input int maxSamples = 100 {"widget":"slider", "min":25, "max":500, "step":25}
 * @input int calculationInterval = 2 {"widget":"slider", "min":1, "max":10, "step":1}
 * @input float smoothingFactor = 0.3 {"widget":"slider", "min":0.0, "max":1.0, "step":0.1}
 * @input float foveaSize = 0.4 {"widget":"slider", "min":0.1, "max":0.8, "step":0.05}
 * @input bool sendToBackend = true
 * @input string backendUrl = "http://localhost:5000/api/brightness"
 * @input int sendInterval = 10 {"widget":"slider", "min":1, "max":60, "step":1}
 * @input float brightnessThreshold = 0.5 {"widget":"slider", "min":0.0, "max":1.0, "step":0.05}
 * @input float triggerDuration = 5.0 {"widget":"slider", "min":1.0, "max":30.0, "step":0.5}
 * @input bool enableLogging = false
 */

// WCAG Relative Luminance coefficients
const WCAG_R = 0.2126;
const WCAG_G = 0.7152;
const WCAG_B = 0.0722;

// Global alert boolean - shared across all scripts
// Access from other scripts: global.alert
if (typeof global.alert === 'undefined') {
    global.alert = false;
}

// Global state
var state = {
    value: 0.0,
    smoothedValue: 0.0,
    frameCount: 0,
    lastCalculatedFrame: 0,
    lastSentFrame: 0,
    lastSentTime: 0,
    textureWidth: 0,
    textureHeight: 0,
    cachedSamples: [],  // Pre-calculated sample positions
    // Note: ProceduralTextureProvider is now created fresh each frame
    // Brightness trigger state
    isOverThreshold: false,
    overThresholdDuration: 0.0,
    lastUpdateTime: 0.0,
    triggerActive: false,
    hasTriggered: false  // Track if trigger has fired for this session
};

// Initialize ProceduralTextureProvider
function initialize() {
    // Try to get camera texture from input or liveTarget
    var cameraTexture = null;
    
    if (script.deviceCameraTexture) {
        cameraTexture = script.deviceCameraTexture;
        print("BrightnessCalculator: Using deviceCameraTexture input");
    } else {
        print("WARNING: BrightnessCalculator - No camera texture available!");
        print("Please assign deviceCameraTexture input or ensure liveTarget is available");
    }
    
    if (cameraTexture) {
        try {
            // Get texture dimensions for sample position generation
            state.textureWidth = cameraTexture.getWidth();
            state.textureHeight = cameraTexture.getHeight();
            state.cachedSamples = generateSamplePositions(state.textureWidth, state.textureHeight, script.maxSamples);
            print("BrightnessCalculator initialized successfully. Texture size: " + state.textureWidth + "x" + state.textureHeight);
            print("Note: ProceduralTextureProvider will be created fresh each frame for accurate readings");
        } catch (e) {
            print("ERROR: BrightnessCalculator - Failed to initialize: " + e.toString());
        }
    }
}

// Initialize on script load
initialize();

// Initialize time tracking
state.lastUpdateTime = getTime();

/**
 * Trigger function called when brightness is over threshold for triggerDuration
 * Override this or connect to your trigger mechanism
 */
function onBrightnessTrigger() {
    // This is called when brightness threshold is exceeded for triggerDuration
    print("[BrightnessCalculator] TRIGGER: Brightness has been over " + 
          script.brightnessThreshold.toFixed(2) + " for " + 
          state.overThresholdDuration.toFixed(1) + " seconds");

    // Set global alert flag
    global.alert = true;
    
    // You can add custom trigger logic here:
    // - Dim lights
    // - Show warning
    // - Play sound
    // - Trigger other scripts
    // etc.
}

/**
 * Calculate brightness from RGB values using WCAG Relative Luminance formula
 * Optimized version - color values are already normalized (0-1)
 * @param {number} r Red channel (0-1, already normalized from texture)
 * @param {number} g Green channel (0-1, already normalized from texture)
 * @param {number} b Blue channel (0-1, already normalized from texture)
 * @returns {number} Brightness value (0.0 to 1.0)
 */
function calculateBrightness(r, g, b) {
    // Apply WCAG Relative Luminance formula
    // L = 0.2126 * R + 0.7152 * G + 0.0722 * B
    // Color values from texture.sample() are already normalized (0-1)
    return WCAG_R * r + WCAG_G * g + WCAG_B * b;
}

/**
 * Generate foveated samples (high density center, lower density periphery)
 * Mimics human foveated vision: dense center region + sparse periphery
 * @param {number} width Texture width
 * @param {number} height Texture height
 * @param {number} maxSamples Maximum number of samples
 * @param {number} foveaSize Size of fovea region (0-1)
 * @returns {Array} Array of {x, y} sample positions (normalized 0-1)
 */
function generateFoveatedSamples(width, height, maxSamples, foveaSize) {
    var samples = [];
    var centerX = width / 2.0;
    var centerY = height / 2.0;
    
    // Allocate 70% of samples to center (fovea), 30% to periphery
    var foveaSamples = Math.floor(maxSamples * 0.7);
    var peripherySamples = maxSamples - foveaSamples;
    
    // Fovea region (center, high density)
    var foveaRadiusX = (width * foveaSize) / 2.0;
    var foveaRadiusY = (height * foveaSize) / 2.0;
    
    for (var i = 0; i < foveaSamples; i++) {
        // Uniform distribution within fovea circle
        var angle = Math.random() * 2.0 * Math.PI;
        var radius = Math.sqrt(Math.random()) * Math.min(foveaRadiusX, foveaRadiusY);
        
        var x = centerX + Math.cos(angle) * radius;
        var y = centerY + Math.sin(angle) * radius;
        
        // Clamp to valid range
        x = Math.max(0, Math.min(width - 1, x));
        y = Math.max(0, Math.min(height - 1, y));
        
        samples.push({
            x: x / width,
            y: y / height
        });
    }
    
    // Periphery region (sparse, uniform distribution)
    for (var i = 0; i < peripherySamples; i++) {
        var x, y;
        var attempts = 0;
        
        // Sample from outside fovea region
        do {
            x = Math.random() * width;
            y = Math.random() * height;
            
            // Check if outside fovea
            var dx = (x - centerX) / foveaRadiusX;
            var dy = (y - centerY) / foveaRadiusY;
            var distSq = dx * dx + dy * dy;
            
            attempts++;
        } while (distSq < 1.0 && attempts < 20);  // Outside fovea circle
        
        samples.push({
            x: x / width,
            y: y / height
        });
    }
    
    return samples;
}

/**
 * Generate sample positions using foveated vision pattern
 * @param {number} width Texture width
 * @param {number} height Texture height
 * @param {number} maxSamples Maximum number of samples
 * @returns {Array} Array of {x, y} sample positions (normalized 0-1)
 */
function generateSamplePositions(width, height, maxSamples) {
    var foveaSize = script.foveaSize || 0.4;
    return generateFoveatedSamples(width, height, maxSamples, foveaSize);
}

/**
 * Calculate brightness using ProceduralTextureProvider.getPixels()
 * This is the recommended way to read pixel values in Lens Studio
 * @returns {number} Average brightness (0.0 to 1.0)
 */
function calculateFrameBrightness() {
    // Get fresh camera texture each frame to ensure we're reading current frame
    var cameraTexture = script.deviceCameraTexture;
    if (!cameraTexture) {
        return state.smoothedValue > 0 ? state.smoothedValue : 0.0;
    }
    
    // Recreate ProceduralTextureProvider each frame to get fresh pixel data
    // This ensures we're reading the current frame, not a cached one
    var proceduralTexture;
    try {
        proceduralTexture = ProceduralTextureProvider.createFromTexture(cameraTexture);
    } catch (e) {
        if (script.enableLogging && state.frameCount % 60 === 0) {
            print("[BrightnessCalculator] Error creating ProceduralTextureProvider: " + e.toString());
        }
        return state.smoothedValue > 0 ? state.smoothedValue : 0.0;
    }
    
    if (!proceduralTexture || !proceduralTexture.control) {
        return state.smoothedValue > 0 ? state.smoothedValue : 0.0;
    }
    
    // Update texture dimensions if they changed
    var textureWidth = cameraTexture.getWidth();
    var textureHeight = cameraTexture.getHeight();
    
    if (textureWidth !== state.textureWidth || textureHeight !== state.textureHeight || state.cachedSamples.length === 0) {
        state.textureWidth = textureWidth;
        state.textureHeight = textureHeight;
        state.cachedSamples = generateSamplePositions(textureWidth, textureHeight, script.maxSamples);
    }
    
    var totalBrightness = 0.0;
    var validSamples = 0;
    var pixelData = new Uint8Array(4);  // RGBA array
    
    // Sample using pre-calculated positions
    for (var i = 0; i < state.cachedSamples.length; i++) {
        var samplePos = state.cachedSamples[i];
        
        try {
            // Convert normalized coordinates to pixel coordinates
            var pixelX = Math.floor(samplePos.x * textureWidth);
            var pixelY = Math.floor(samplePos.y * textureHeight);
            
            // Ensure coordinates are within bounds
            pixelX = Math.max(0, Math.min(textureWidth - 1, pixelX));
            pixelY = Math.max(0, Math.min(textureHeight - 1, pixelY));
            
            // Read pixel using ProceduralTextureProvider.getPixels()
            // getPixels(x, y, width, height, dataArray)
            proceduralTexture.control.getPixels(pixelX, pixelY, 1, 1, pixelData);
            
            // Pixel data is in 0-255 range, normalize to 0-1
            var r = pixelData[0] / 255.0;
            var g = pixelData[1] / 255.0;
            var b = pixelData[2] / 255.0;
            
            // Calculate brightness using WCAG formula
            var pixelBrightness = calculateBrightness(r, g, b);
            totalBrightness += pixelBrightness;
            validSamples++;
        } catch (error) {
            // Skip this sample if reading fails
            if (script.enableLogging && i === 0 && state.frameCount % 60 === 0) {
                print("[BrightnessCalculator] Error reading pixel: " + error.toString());
            }
        }
    }
    
    // Return average brightness (only from valid samples)
    if (validSamples === 0) {
        return state.smoothedValue > 0 ? state.smoothedValue : 0.0;
    }
    
    return totalBrightness / validSamples;
}

/**
 * Send brightness data to Python backend using InternetModule.fetch
 * @param {number} brightness Brightness value to send
 */
function sendBrightnessToBackend(brightness) {
    if (!script.sendToBackend || !script.backendUrl) {
        return;
    }
    
    try {
        // Create payload
        var payload = {
            brightness: brightness,
            timestamp: new Date().toISOString(),
            frame: state.frameCount,
            device: "spectacles"
        };
        
        // Use Lens Studio's InternetModule.fetch API (requires InternetModule in project)
        var InternetModule = require('InternetModule');
        
        var options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        };
        
        InternetModule.fetch(script.backendUrl, options)
            .then(function(response) {
                if (script.enableLogging) {
                    print("[BrightnessCalculator] Sent brightness " + brightness.toFixed(4) + " to backend. Status: " + response.status);
                }
                state.lastSentTime = getTime();
            })
            .catch(function(error) {
                if (script.enableLogging) {
                    print("[BrightnessCalculator] HTTP request error: " + error.toString());
                }
            });
        
    } catch (error) {
        print("[BrightnessCalculator] Error sending to backend: " + error.toString());
    }
}

// Cache for text display to avoid string operations every frame
var cachedText = "";
var lastDisplayedValue = -1.0;

/**
 * Update function called every frame (performance optimized)
 */
function onUpdate() {
    // Check if camera texture is available
    if (!script.deviceCameraTexture) {
        // Try to initialize if not already done
        if (state.frameCount % 60 === 0) {
            initialize();
        }
        state.frameCount++;
        return;
    }
    
    state.frameCount++;
    var currentTime = getTime();
    var deltaTime = currentTime - state.lastUpdateTime;
    state.lastUpdateTime = currentTime;
    
    // Only calculate brightness every N frames (configurable)
    var shouldCalculate = (state.frameCount - state.lastCalculatedFrame) >= script.calculationInterval;
    
    if (shouldCalculate) {
        // Calculate brightness using ProceduralTextureProvider.getPixels()
        var newBrightness = calculateFrameBrightness();
        
        // Apply exponential moving average for smoothing
        if (state.smoothedValue === 0.0 && newBrightness > 0.0) {
            state.smoothedValue = newBrightness;
        } else if (newBrightness > 0.0) {
            state.smoothedValue = state.smoothedValue * (1.0 - script.smoothingFactor) + 
                                   newBrightness * script.smoothingFactor;
        }
        
        state.value = newBrightness;
        state.lastCalculatedFrame = state.frameCount;
    }
    
    // Check if brightness is over threshold
    var wasOverThreshold = state.isOverThreshold;
    state.isOverThreshold = state.smoothedValue > script.brightnessThreshold;
    
    // Update duration
    if (state.isOverThreshold) {
        state.overThresholdDuration += deltaTime;
    } else {
        // Reset duration and trigger state when below threshold
        state.overThresholdDuration = 0.0;
        state.triggerActive = false;
        state.hasTriggered = false;
    }
    
    // Check if trigger should be active (over threshold for too long)
    var wasTriggerActive = state.triggerActive;
    state.triggerActive = state.overThresholdDuration > script.triggerDuration;
    
    // Trigger once when threshold is exceeded
    if (state.triggerActive && !wasTriggerActive && !state.hasTriggered) {
        onBrightnessTrigger();
        state.hasTriggered = true;
    }
    
    // Update text display if text component is assigned (only when value changes significantly)
    if (script.textComponent) {
        var displayValue = script.showPercentage ? state.smoothedValue * 100 : state.smoothedValue;
        var threshold = script.showPercentage ? 0.1 : 0.001;  // Update threshold
        
        if (Math.abs(displayValue - lastDisplayedValue) > threshold) {
            if (script.showPercentage) {
                cachedText = "Brightness: " + displayValue.toFixed(2) + "%";
            } else {
                cachedText = "Brightness: " + displayValue.toFixed(4);
            }
            script.textComponent.text = cachedText;
            lastDisplayedValue = displayValue;
        }
    }
    
    // Send to backend periodically (not every frame to reduce network traffic)
    if (script.sendToBackend && (state.frameCount - state.lastSentFrame) >= script.sendInterval) {
        sendBrightnessToBackend(state.smoothedValue);  // Send smoothed value
        state.lastSentFrame = state.frameCount;
    }
    
    // Optional: Log brightness for debugging
    if (script.enableLogging && state.frameCount % 30 === 0) {
        if (script.showPercentage) {
            print("[BrightnessCalculator] Frame " + state.frameCount + ": Brightness = " + state.smoothedValue.toFixed(2) + "%" + " (raw: " + state.value.toFixed(4) + ")");            
        } else {
            print("[BrightnessCalculator] Frame " + state.frameCount + ": Brightness = " + state.smoothedValue.toFixed(4) + " (raw: " + state.value.toFixed(4) + ")");            
        }
    }
}

// Register update callback
var updateEvent = script.createEvent("UpdateEvent");
updateEvent.bind(onUpdate);

// Export API for use in other scripts
script.api.getBrightness = function() {
    return state.smoothedValue;  // Return smoothed value for stability
};

script.api.getBrightnessRaw = function() {
    return state.value;  // Return raw calculated value
};

script.api.getBrightnessPercentage = function() {
    return state.smoothedValue * 100.0;
};

script.api.getFrameCount = function() {
    return state.frameCount;
};

script.api.getBrightnessCategory = function() {
    var val = state.smoothedValue;
    if (val < 0.33) {
        return "dark";
    } else if (val < 0.67) {
        return "medium";
    } else {
        return "bright";
    }
};

// Export trigger-related API
script.api.isOverThreshold = function() {
    return state.isOverThreshold;
};

script.api.isTriggerActive = function() {
    return state.triggerActive;
};

script.api.getOverThresholdDuration = function() {
    return state.overThresholdDuration;
};

// Allow external scripts to override trigger function
script.api.onBrightnessTrigger = onBrightnessTrigger;
