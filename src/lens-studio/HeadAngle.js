/**
 * Posture Monitor for Lens Studio
 * Monitors head pitch angle (Y-axis - up/down) and triggers when looking down too long
 * 
 * SETUP: Make sure DeviceTracking component is enabled on your Camera or another object
 * 
 * @input Component.Text warningTextComponent
 * @input Component.DeviceTracking deviceTracking  // DeviceTracking component (usually on Camera)
 * @input float pitchThreshold = 20.0 {"widget":"slider", "min":5.0, "max":45.0, "step":1.0}
 * @input float triggerDuration = 5.0 {"widget":"slider", "min":1.0, "max":30.0, "step":0.5}
 * @input bool sendToBackend = true
 * @input string backendUrl = "http://localhost:5000/api/posture"
 * @input int sendInterval = 30 {"widget":"slider", "min":1, "max":120, "step":1}
 * @input bool enableLogging = false
 */

// Global alert boolean - shared across all scripts
// Access from other scripts: global.alert
if (typeof global.alert === 'undefined') {
    global.alert = false;
}

// Global state
var state = {
    pitchAngle: 0.0,
    isLookingDown: false,
    downDuration: 0.0,
    lastUpdateTime: 0.0,
    lastSentFrame: 0,
    frameCount: 0,
    triggerActive: false,
    hasTriggered: false,  // Track if trigger has fired for this session
    deviceTracking: null,
    headTransform: null
};

// Initialize
function initialize() {
    if (script.deviceTracking) {
        state.deviceTracking = script.deviceTracking;
        print("PostureMonitor: Using DeviceTracking component from input");
    }
    
    if (!state.deviceTracking && !state.headTransform) {
        print("WARNING: PostureMonitor - Head tracking not available.");
        print("Please ensure DeviceTracking component is enabled on Camera or assign it to the script input.");
    } else {
        print("PostureMonitor initialized successfully");
    }
    
    state.lastUpdateTime = getTime();
}

// Initialize on script load
initialize();

/**
 * Trigger function called when user looks down for too long
 * Override this or connect to your trigger mechanism
 */
function onTrigger() {
    // This is called when pitch threshold is exceeded for triggerDuration
    print("[PostureMonitor] TRIGGER: User has been looking down for " + 
          state.downDuration.toFixed(1) + " seconds");
    
    // Set global alert flag
    global.alert = true;
    
    // You can add custom trigger logic here:
    // - Show notification
    // - Play sound
    // - Send alert
    // - Trigger other scripts
    // etc.
}

/**
 * Send pitch angle data to backend
 * @param {number} pitch Pitch angle in degrees (Y-axis)
 * @param {number} downDuration Duration looking down in seconds
 */
function sendToBackend(pitch, downDuration) {
    if (!script.sendToBackend || !script.backendUrl) {
        return;
    }
    
    try {
        var payload = {
            pitch: pitch,
            downDuration: downDuration,
            isLookingDown: state.isLookingDown,
            triggerActive: state.triggerActive,
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
                    print("[PostureMonitor] Sent pitch data to backend. Status: " + response.status);
                }
            })
            .catch(function(error) {
                if (script.enableLogging) {
                    print("[PostureMonitor] HTTP request error: " + error.toString());
                }
            });
    } catch (error) {
        print("[PostureMonitor] Error sending to backend: " + error.toString());
    }
}

/**
 * Update warning text display
 */
function updateWarningDisplay() {
    if (!script.warningTextComponent) {
        return;
    }
    
    if (state.triggerActive) {
        var duration = state.downDuration.toFixed(1);
        var message = "Look Up! You've been looking down for " + duration + "s";
        
        // Make warning more urgent if duration is very long
        if (state.downDuration > script.triggerDuration * 2) {
            message = "URGENT: Look Up Now! (" + duration + "s)";
        }
        
        script.warningTextComponent.text = message;
        
        // Change text color to red
        if (script.warningTextComponent.textFill) {
            script.warningTextComponent.textFill = new vec4(1.0, 0.2, 0.2, 1.0); // Red
        }
    } else {
        script.warningTextComponent.text = "";
    }
}

/**
 * Get head rotation from available tracking method
 * @returns {quat} Rotation quaternion or null
 */
function getHeadRotation() {
    try {
        // Use DeviceTracking component
        if (state.deviceTracking) {
            try {
                // DeviceTracking provides head rotation directly
                if (state.deviceTracking.getHeadRotation) {
                    return state.deviceTracking.getHeadRotation();
                }
                // Or get transform from DeviceTracking
                if (state.deviceTracking.getTransform) {
                    var transform = state.deviceTracking.getTransform();
                    if (transform && transform.getWorldRotation) {
                        return transform.getWorldRotation();
                    }
                }
            } catch (e) {
                if (script.enableLogging) {
                    print("PostureMonitor: Error accessing DeviceTracking - " + e.toString());
                }
            }
        }
        
    } catch (e) {
        if (script.enableLogging) {
            print("PostureMonitor: Error getting head rotation - " + e.toString());
        }
    }
    
    return null;
}

/**
 * Extract pitch angle (X-axis rotation) from quaternion
 * Pitch = rotation around X-axis (looking up/down)
 * @param {quat} rotation Rotation quaternion
 * @returns {number} Pitch angle in degrees (positive = looking down)
 */
function getPitchAngle(rotation) {
    // Extract quaternion components
    var w = rotation.w;
    var x = rotation.x;
    var y = rotation.y;
    var z = rotation.z;
    
    // Calculate pitch (rotation around X-axis) - looking up/down
    // Using standard quaternion to Euler conversion for pitch
    // sin(pitch) = 2 * (w * x - y * z)
    var sinp = 2 * (w * x - y * z);
    var pitch;
    
    // Clamp sinp to valid range for asin
    if (Math.abs(sinp) >= 1) {
        pitch = Math.sign(sinp) * Math.PI / 2; // Use 90 degrees if out of range
    } else {
        pitch = Math.asin(sinp);
    }
    
    // Convert to degrees
    var pitchDegrees = pitch * (180.0 / Math.PI);
    
    // If the result seems wrong (detecting yaw instead), try alternative formula
    // Alternative: pitch = atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    // This uses atan2 which handles all quadrants correctly
    var altPitch = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    var altPitchDegrees = altPitch * (180.0 / Math.PI);
    
    // Return the asin version (standard), but you can switch to altPitchDegrees if needed
    return pitchDegrees;
}

/**
 * Update function called every frame
 */
function onUpdate() {
    if (!state.deviceTracking && !state.headTransform) {
        // Try to reinitialize if head tracking becomes available
        if (state.frameCount % 60 === 0) {
            initialize();
        }
        return;
    }
    
    state.frameCount++;
    var currentTime = getTime();
    var deltaTime = currentTime - state.lastUpdateTime;
    state.lastUpdateTime = currentTime;
    
    // Get head rotation angles
    var rotation = getHeadRotation();
    
    if (!rotation) {
        return;
    }
    
    try {
        // Extract only pitch angle (Y-axis - up/down)
        state.pitchAngle = getPitchAngle(rotation);
        
    } catch (e) {
        if (script.enableLogging) {
            print("PostureMonitor: Error getting pitch angle - " + e.toString());
        }
        return;
    }
    
    // Check if looking down past threshold
    var wasLookingDown = state.isLookingDown;
    state.isLookingDown = state.pitchAngle < script.pitchThreshold;
    
    // Update duration
    if (state.isLookingDown) {
        state.downDuration += deltaTime;
    } else {
        // Reset duration and trigger state when looking up
        state.downDuration = 0.0;
        state.triggerActive = false;
        state.hasTriggered = false;
    }
    
    // Check if trigger should be active (looking down for too long)
    var wasTriggerActive = state.triggerActive;
    state.triggerActive = state.downDuration > script.triggerDuration;
    
    // Trigger once when threshold is exceeded
    if (state.triggerActive && !wasTriggerActive && !state.hasTriggered) {
        onTrigger();
        state.hasTriggered = true;
    }
    
    // Update warning display
    updateWarningDisplay();
    
    // Send to backend periodically
    if (script.sendToBackend && (state.frameCount - state.lastSentFrame) >= script.sendInterval) {
        sendToBackend(state.pitchAngle, state.downDuration);
        state.lastSentFrame = state.frameCount;
    }
    
    // Logging
    if (script.enableLogging && state.frameCount % 60 === 0) {
        print("[PostureMonitor] Pitch: " + state.pitchAngle.toFixed(1) + 
              "°, Down: " + state.downDuration.toFixed(1) + "s" +
              (state.triggerActive ? " [TRIGGERED]" : ""));
    }
}

// Register update callback
var updateEvent = script.createEvent("UpdateEvent");
updateEvent.bind(onUpdate);

// Export API for use in other scripts
script.api.getPitchAngle = function() {
    return state.pitchAngle;
};

script.api.getDownDuration = function() {
    return state.downDuration;
};

script.api.isLookingDown = function() {
    return state.isLookingDown;
};

script.api.isTriggerActive = function() {
    return state.triggerActive;
};

// Allow external scripts to override trigger function
script.api.onTrigger = onTrigger;

