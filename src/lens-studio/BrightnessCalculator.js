/**
 * Brightness Calculator for Lens Studio (Performance Optimized)
 * Calculates WCAG Relative Luminance in real-time and sends to Python backend
 * 
 * Uses global.scene.liveTarget to access the live camera feed
 * 
 * @input Component.Text textComponent
 * @input bool showPercentage = false
 * @input int maxSamples = 100 {"widget":"slider", "min":25, "max":500, "step":25}
 * @input int calculationInterval = 2 {"widget":"slider", "min":1, "max":10, "step":1}
 * @input float smoothingFactor = 0.3 {"widget":"slider", "min":0.0, "max":1.0, "step":0.1}
 * @input float foveaSize = 0.4 {"widget":"slider", "min":0.1, "max":0.8, "step":0.05}
 * @input bool sendToBackend = true
 * @input string backendUrl = "http://localhost:5000/api/brightness"
 * @input int sendInterval = 10 {"widget":"slider", "min":1, "max":60, "step":1}
 * @input bool enableLogging = false
 */

// WCAG Relative Luminance coefficients
const WCAG_R = 0.2126;
const WCAG_G = 0.7152;
const WCAG_B = 0.0722;

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
    cachedSamples: []  // Pre-calculated sample positions
};

// Initialize - check if liveTarget is available
if (!global.scene || !global.scene.liveTarget) {
    print("WARNING: BrightnessCalculator - global.scene.liveTarget not available. Waiting for camera...");
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
 * Sample texture and calculate average brightness (optimized)
 * @param {Texture} texture Camera texture to sample
 * @returns {number} Average brightness (0.0 to 1.0)
 */
function calculateFrameBrightness(texture) {
    if (!texture) {
        return 0.0;
    }
    
    var width = texture.getWidth();
    var height = texture.getHeight();
    
    // Recalculate sample positions if texture size changed
    if (width !== state.textureWidth || height !== state.textureHeight || state.cachedSamples.length === 0) {
        state.textureWidth = width;
        state.textureHeight = height;
        state.cachedSamples = generateSamplePositions(width, height, script.maxSamples);
    }
    
    var totalBrightness = 0.0;
    var sampleCount = state.cachedSamples.length;
    
    // Sample using pre-calculated positions
    for (var i = 0; i < sampleCount; i++) {
        var samplePos = state.cachedSamples[i];
        
        // Get pixel color at sample position
        var color = texture.sample({
            x: samplePos.x,
            y: samplePos.y
        });
        
        // Calculate brightness directly (color already normalized 0-1)
        var pixelBrightness = calculateBrightness(color.r, color.g, color.b);
        
        totalBrightness += pixelBrightness;
    }
    
    // Return average brightness
    return sampleCount > 0 ? totalBrightness / sampleCount : 0.0;
}

/**
 * Send brightness data to Python backend using global.http
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
        
        // Use Lens Studio's global.http API
        var options = {
            headers: { "Content-Type": "application/json" }
        };
        
        global.http.post(
            script.backendUrl,
            JSON.stringify(payload),
            options,
            function(response) {
                if (script.enableLogging) {
                    print("[BrightnessCalculator] Sent brightness " + brightness.toFixed(4) + " to backend. Response: " + response);
                }
                state.lastSentTime = getTime();
            }
        );
        
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
    // Access the live camera texture using global.scene.liveTarget
    var liveCameraTexture = global.scene.liveTarget;
    
    if (!liveCameraTexture) {
        // Camera not ready yet, skip this frame
        return;
    }
    
    state.frameCount++;
    
    // Only calculate brightness every N frames (configurable)
    var shouldCalculate = (state.frameCount - state.lastCalculatedFrame) >= script.calculationInterval;
    
    if (shouldCalculate) {
        // Calculate brightness for current frame
        var newBrightness = calculateFrameBrightness(liveCameraTexture);
        
        // Apply exponential moving average for smoothing
        if (state.smoothedValue === 0.0) {
            state.smoothedValue = newBrightness;
        } else {
            state.smoothedValue = state.smoothedValue * (1.0 - script.smoothingFactor) + 
                                   newBrightness * script.smoothingFactor;
        }
        
        state.value = newBrightness;
        state.lastCalculatedFrame = state.frameCount;
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
        print("[BrightnessCalculator] Frame " + state.frameCount + ": Brightness = " + state.smoothedValue.toFixed(4) + " (raw: " + state.value.toFixed(4) + ")");
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
