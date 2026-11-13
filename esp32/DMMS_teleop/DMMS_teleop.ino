#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <math.h>

// Hardware
#define LED_PIN   21
#define LED_COUNT 60

const int M1_DIR = 26;
const int M1_PWM = 19;
const int M1_FG  = 34;

const int M2_DIR = 25;
const int M2_PWM = 12; 
const int M2_FG  = 35;

const int M3_DIR = 33;
const int M3_PWM = 14;
const int M3_FG  = 39;

const int M4_DIR = 32;
const int M4_PWM = 27;
const int M4_FG  = 36;

const int Servo1 = 22;
const int Servo2 = 23;

struct Motor {
  int dirPin;
  int pwmPin;
  int fgPin;
  bool invertDirection;
};

Motor motors[4] = {
  {M1_DIR, M1_PWM, M1_FG, true},
  {M2_DIR, M2_PWM, M2_FG, true},
  {M3_DIR, M3_PWM, M3_FG, false},
  {M4_DIR, M4_PWM, M4_FG, false}
};

// volatile long pulseCounts[4] = {0, 0, 0, 0};
// void IRAM_ATTR isrMotor0() { pulseCounts[0]++; }
// void IRAM_ATTR isrMotor1() { pulseCounts[1]++; }
// void IRAM_ATTR isrMotor2() { pulseCounts[2]++; }
// void IRAM_ATTR isrMotor3() { pulseCounts[3]++; }
// void (*isrTable[4])() = {isrMotor0, isrMotor1, isrMotor2, isrMotor3};
// unsigned long previousMillis = 0;
// const long interval = 1000; // Calculate RPM every 1000 ms (1 second)

Servo servoMotor1;
Servo servoMotor2;

Adafruit_NeoPixel strip(
  LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800
);

// Communication safety
constexpr unsigned long COMMAND_TIMEOUT_MS = 300000;
unsigned long lastDriveCommand = 0;
bool driveCommandReceived = false;

// Protocol state
const uint8_t PROTOCOL_VERSION = 1;

// Operating System & State Machine Definitions
enum RoverMode { MODE_BOOT, MODE_INTERACTIVE, MODE_MANUAL, MODE_AUTOMATIC };
RoverMode currentMode = MODE_BOOT;

bool isTransitioning = false;
unsigned long transitionStartTime = 0;
constexpr unsigned long TRANSITION_DURATION_MS = 3000;

bool estopLatched = false;
bool discardingInput = false;

// Custom Lighting Control System State Variables
enum LedAnimation { ANIM_STATE_DRIVEN, ANIM_SOLID, ANIM_WAVE, ANIM_SNOWFLAKE, ANIM_CIRCULATING };
LedAnimation currentLedAnim = ANIM_STATE_DRIVEN;

uint8_t customR = 255, customG = 255, customB = 255;
uint8_t customBrightness = 128;
uint16_t animSpeed = 50; 
unsigned long lastAnimUpdate = 0;
uint16_t animFrameCounter = 0;

// Send a structured acknowledgement.
void sendAck(
  uint32_t id,
  const char *status,
  const char *errorCode = nullptr,
  const char *message = nullptr
) {
  JsonDocument response;

  response["v"] = PROTOCOL_VERSION;
  response["type"] = "ack";
  response["id"] = id;
  response["status"] = status;

  if (errorCode != nullptr) {
    response["error"]["code"] = errorCode;
  }

  if (message != nullptr) {
    response["error"]["message"] = message;
  }

  serializeJson(response, Serial);
  Serial.println();
}

// Report an event, such as an E-stop activation.
void sendEvent(const char *eventName) {
  JsonDocument response;

  response["v"] = PROTOCOL_VERSION;
  response["type"] = "event";
  response["event"] = eventName;

  serializeJson(response, Serial);
  Serial.println();
}

// A JSON number may be represented as an integer or floating point.
bool isJsonNumber(JsonVariantConst value) {
  return value.is<int>() ||
         value.is<long>() ||
         value.is<unsigned int>() ||
         value.is<unsigned long>() ||
         value.is<float>() ||
         value.is<double>();
}

char inputBuffer[256];
size_t inputLength = 0;

void setMotor(int index, float command) {
  command = constrain(command, -1.0f, 1.0f);

  Motor &m = motors[index];

  bool forward = command >= 0.0f;

  if (m.invertDirection) {
    forward = !forward;
  }

  int pwm = 255 - (int)(fabsf(command) * 254.0f + 0.5f);

  if (pwm == 0) {
    analogWrite(m.pwmPin, 0);
    return;
  }

  digitalWrite(m.dirPin, forward ? HIGH : LOW);
  analogWrite(m.pwmPin, pwm);
}

void stopMotors() {
  for (int i = 0; i < 4; i++) {
    analogWrite(motors[i].pwmPin, 255);
  }
}

// Complex Multi-threaded Lighting Engine
uint32_t Wheel(byte WheelPos) {
  WheelPos = 255 - WheelPos;
  if(WheelPos < 85) return strip.Color(255 - WheelPos * 3, 0, WheelPos * 3);
  if(WheelPos < 170) { WheelPos -= 85; return strip.Color(0, WheelPos * 3, 255 - WheelPos * 3); }
  WheelPos -= 170; return strip.Color(WheelPos * 3, 255 - WheelPos * 3, 0);
}

void runLightingEngine() {
  // Global Safe Lockout: Strip completely shuts off if an active hardware E-Stop is triggered
  if (estopLatched) {
    strip.clear();
    strip.show();
    return;
  }

  unsigned long now = millis();
  // Maps standard velocity frequencies natively into operational loop cycles
  unsigned long interval = map(constrain(animSpeed, 1, 100), 1, 100, 150, 10);
  bool tick = (now - lastAnimUpdate >= interval);
  if (tick) { lastAnimUpdate = now; animFrameCounter++; }

  // 1. Process Absolute Overrides if Pi commanded specific pattern variants
  if (currentLedAnim != ANIM_STATE_DRIVEN) {
    strip.setBrightness(customBrightness);
    
    if (currentLedAnim == ANIM_SOLID) {
      for(int i=0; i<LED_COUNT; i++) strip.setPixelColor(i, strip.Color(customR, customG, customB));
    }
    else if (currentLedAnim == ANIM_WAVE) {
      for(int i=0; i<LED_COUNT; i++) {
        strip.setPixelColor(i, Wheel(((i * 256 / LED_COUNT) + animFrameCounter) & 255));
      }
    }
    else if (currentLedAnim == ANIM_SNOWFLAKE) {
      for(int i=0; i<LED_COUNT; i++) {
        // Generate pseudo-random soft shimmering pulses mapping blue-white variances
        uint8_t noise = (sin((animFrameCounter + i) * 0.4f) * 40) + 180; 
        strip.setPixelColor(i, strip.Color(noise - 40, noise - 20, noise));
      }
    }
    else if (currentLedAnim == ANIM_CIRCULATING) {
      strip.clear();
      // Projects 3 independent cascading focus trackers wrapping array lengths
      for(int head = 0; head < 3; head++) {
        int pos = (animFrameCounter + (head * (LED_COUNT / 3))) % LED_COUNT;
        strip.setPixelColor(pos, strip.Color(255, 255, 255));
        strip.setPixelColor((pos + 1) % LED_COUNT, strip.Color(200, 200, 200));
        strip.setPixelColor((pos + 2) % LED_COUNT, strip.Color(100, 100, 100));
      }
    }
    strip.show();
    return;
  }

  // 2. Fallback Pattern Engine: Handle Reactive Physical State Profiles
  strip.setBrightness(128); // Force constant nominal baseline output limits

  if (isTransitioning) {
    if (currentMode == MODE_MANUAL) { // 3s Blue Blip Phase
      for(int i=0; i<LED_COUNT; i++) strip.setPixelColor(i, strip.Color(0, 0, 255));
    } else if (currentMode == MODE_AUTOMATIC) { // 3s Teal Blip Phase
      for(int i=0; i<LED_COUNT; i++) strip.setPixelColor(i, strip.Color(0, 128, 128));
    }
  } else {
    switch (currentMode) {
      case MODE_BOOT:        // Solid Magenta on start
        for(int i=0; i<LED_COUNT; i++) strip.setPixelColor(i, strip.Color(255, 0, 255)); break;
      case MODE_INTERACTIVE: // Safe mechanics touch state (Solid White)
        for(int i=0; i<LED_COUNT; i++) strip.setPixelColor(i, strip.Color(255, 255, 255)); break;
      case MODE_MANUAL:      // Operational remote driving tracking (Solid Blue)
        for(int i=0; i<LED_COUNT; i++) strip.setPixelColor(i, strip.Color(0, 0, 255)); break;
      case MODE_AUTOMATIC:   // Live programmatic tracing path sequence (Solid Green)
        for(int i=0; i<LED_COUNT; i++) strip.setPixelColor(i, strip.Color(0, 255, 0)); break;
    }
  }
  strip.show();
}

void handleMessage(char *message) {
  JsonDocument doc;

  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    sendAck(0, "rejected", "INVALID_JSON", "Invalid JSON");
    return;
  }

  // Require protocol version 1.
  if (doc["v"].isNull() ||
      doc["v"].as<int>() != PROTOCOL_VERSION) {
    sendAck(
      doc["id"] | 0,
      "rejected",
      "UNSUPPORTED_VERSION",
      "Expected protocol version 1"
    );
    return;
  }

  // Require a command ID.
  if (!isJsonNumber(doc["id"])) {
    sendAck(
      0,
      "rejected",
      "INVALID_ARGUMENT",
      "Missing or invalid command ID"
    );
    return;
  }

  uint32_t id = doc["id"].as<uint32_t>();

  if (strcmp(doc["type"] | "", "command") != 0) {
    sendAck(
      id, "rejected", "INVALID_ARGUMENT",
      "Expected message type command"
    );
    return;
  }

  const char *cmd = doc["cmd"] | "";
  JsonVariantConst args = doc["args"];

  // --- CONFIGURE MODE COMMAND ---
  if (strcmp(cmd, "configure") == 0) {
    if (args.isNull() || !args["mode"].is<const char*>()) {
      sendAck(id, "rejected", "INVALID_ARGUMENT", "Configure requires a string mode parameter");
      return;
    }
    const char* targetModeStr = args["mode"].as<const char*>();
    RoverMode targetMode = currentMode;

    if (strcmp(targetModeStr, "interactive") == 0) targetMode = MODE_INTERACTIVE;
    else if (strcmp(targetModeStr, "manual") == 0) targetMode = MODE_MANUAL;
    else if (strcmp(targetModeStr, "automatic") == 0) targetMode = MODE_AUTOMATIC;
    else {
      sendAck(id, "rejected", "INVALID_ARGUMENT", "Unknown operational profile mode");
      return;
    }

    currentMode = targetMode;
    // Check if configuration target demands an operational safety delay window
    if (currentMode == MODE_MANUAL || currentMode == MODE_AUTOMATIC) {
      isTransitioning = true;
      transitionStartTime = millis();
      stopMotors(); // Force drop wheel throttle to safe vectors instantly
    } else {
      isTransitioning = false; // Interactive or Boot drops timers immediately
    }
    
    currentLedAnim = ANIM_STATE_DRIVEN; // Re-sync lights to internal state transitions
    sendAck(id, "accepted");
    return;
  }

  // --- LED HARDWARE PARAMETER COMMAND ---
  if (strcmp(cmd, "led") == 0) {
    if (args.isNull()) { sendAck(id, "rejected", "INVALID_ARGUMENT", "Missing LED parameters"); return; }
    
    const char* modeStr = args["mode"] | "state";
    if (strcmp(modeStr, "state") == 0) currentLedAnim = ANIM_STATE_DRIVEN;
    else if (strcmp(modeStr, "solid") == 0) currentLedAnim = ANIM_SOLID;
    else if (strcmp(modeStr, "wave") == 0) currentLedAnim = ANIM_WAVE;
    else if (strcmp(modeStr, "snowflake") == 0) currentLedAnim = ANIM_SNOWFLAKE;
    else if (strcmp(modeStr, "circulating") == 0) currentLedAnim = ANIM_CIRCULATING;
    else { sendAck(id, "rejected", "INVALID_ARGUMENT", "Unsupported LED animation style profile"); return; }

    // Hex String Conversion Logic: "#RRGGBB" format
    const char* hexColor = args["colour"] | "#FFFFFF";
    if (hexColor[0] == '#') {
      long rgbNum = strtol(&hexColor[1], NULL, 16);
      customR = (rgbNum >> 16) & 0xFF;
      customG = (rgbNum >> 8) & 0xFF;
      customB = rgbNum & 0xFF;
    }

    if (args["brightness"].is<int>()) {
      customBrightness = map(constrain(args["brightness"].as<int>(), 0, 100), 0, 100, 0, 255);
    }

    if (args["speed"].is<int>()) animSpeed = args["speed"].as<int>();

    sendAck(id, "accepted");
    return;
  }

  // --------------------------------------------------
  // DRIVE (Accepts mix of throttle & steering or individual wheels)
  // --------------------------------------------------
  if (strcmp(cmd, "drive") == 0) {
    if (estopLatched) {
      stopMotors();
      driveCommandReceived = false;

      sendAck(
        id, "rejected", "ESTOP_LATCHED",
        "Clear emergency stop before driving"
      );
      return;
    }

    // Core Lockout Checks: Block active wheel movements when robot safety windows are executing
    if (currentMode == MODE_INTERACTIVE) {
      stopMotors(); driveCommandReceived = false;
      sendAck(id, "rejected", "MODE_LOCKOUT", "Motors locked out during Interactive maintenance mode");
      return;
    }
    if (isTransitioning) {
      stopMotors(); driveCommandReceived = false;
      sendAck(id, "rejected", "TRANSITION_LOCKOUT", "Commands blocked during safe 3-second transition delay");
      return;
    }
    if (currentMode == MODE_AUTOMATIC) {
      sendAck(id, "rejected", "AUTO_LOCKOUT", "Manual teleoperation commands blocked during Automatic tracking loops");
      return;
    }

    if (args.isNull()) {
      stopMotors();
      driveCommandReceived = false;
      sendAck(id, "rejected", "INVALID_ARGUMENT", "Drive args missing");
      return;
    }

    float fl = 0.0f, fr = 0.0f, rl = 0.0f, rr = 0.0f;

    // Check if handling consolidated inputs from frontend modifications
    if (isJsonNumber(args["throttle"]) && isJsonNumber(args["steering"])) {
      float throttle = args["throttle"].as<float>();
      float steering = args["steering"].as<float>();

      // Differential Steering Mixer Algorithm
      fl = throttle - steering;
      fr = throttle + steering;
      rl = throttle - steering;
      rr = throttle + steering;
    } 
    // Fallback: Handle raw individual wheel arrays if provided
    else if (isJsonNumber(args["fl"]) && isJsonNumber(args["fr"]) && 
             isJsonNumber(args["rl"]) && isJsonNumber(args["rr"])) {
      fl = args["fl"].as<float>();
      fr = args["fr"].as<float>();
      rl = args["rl"].as<float>();
      rr = args["rr"].as<float>();
    } 
    else {
      stopMotors();
      driveCommandReceived = false;
      sendAck(id, "rejected", "INVALID_ARGUMENT", "Invalid wheel or throttle parameters");
      return;
    }

    // Verify constraints and numbers
    if (!isfinite(fl) || !isfinite(fr) || !isfinite(rl) || !isfinite(rr)) {
      stopMotors();
      driveCommandReceived = false;
      sendAck(id, "rejected", "OUT_OF_RANGE", "Commands must be finite numbers");
      return;
    }

    // Direct Clamping Safeguard
    fl = constrain(fl, -1.0f, 1.0f);
    fr = constrain(fr, -1.0f, 1.0f);
    rl = constrain(rl, -1.0f, 1.0f);
    rr = constrain(rr, -1.0f, 1.0f);

    setMotor(0, fl);
    setMotor(1, rl);
    setMotor(2, rr);
    setMotor(3, fr);

    lastDriveCommand = millis();
    driveCommandReceived = true;

    sendAck(id, "accepted");
  }

  // --------------------------------------------------
  // NORMAL STOP
  // --------------------------------------------------
  else if (strcmp(cmd, "stop") == 0) {
    stopMotors();
    driveCommandReceived = false;

    sendAck(id, "accepted");
  }

  // --------------------------------------------------
  // EMERGENCY STOP: LATCHED
  // --------------------------------------------------
  else if (strcmp(cmd, "estop") == 0) {
    stopMotors();
    driveCommandReceived = false;

    bool wasLatched = estopLatched;
    estopLatched = true;

    sendAck(id, "accepted");

    if (!wasLatched) {
      sendEvent("estop_activated");
    }
  }

  // --------------------------------------------------
  // CLEAR EMERGENCY STOP
  // --------------------------------------------------
  // else if (strcmp(cmd, "clear_estop") == 0) {
  //   if (!estopLatched) {
  //     sendAck(id, "accepted");
  //     return;
  //   }

  //   stopMotors();
  //   driveCommandReceived = false;
  //   estopLatched = false;

  //   sendAck(id, "accepted");
  //   sendEvent("estop_cleared");
  // }
  else if (strcmp(cmd, "clear_estop") == 0) {
    if (!estopLatched) {
        sendAck(id, "accepted");
        return;
    }

    stopMotors();
    driveCommandReceived = false;

    estopLatched = false;

    // Require the operator to explicitly select a mode again.
    currentMode = MODE_MANUAL;
    isTransitioning = false;
    currentLedAnim = ANIM_STATE_DRIVEN;

    sendAck(id, "accepted");
    sendEvent("estop_cleared");
  }

  // --------------------------------------------------
  // SERVOS
  // --------------------------------------------------
  else if (strcmp(cmd, "servos") == 0) {
    if (currentMode == MODE_INTERACTIVE || isTransitioning || currentMode == MODE_AUTOMATIC) {
      sendAck(id, "rejected", "MODE_LOCKOUT", "Servo adjustments strictly blocked outside manual control tracking profiles");
      return;
    }

    if (args.isNull() || !isJsonNumber(args["pan_deg"]) || !isJsonNumber(args["tilt_deg"])) {
      sendAck(id, "rejected", "INVALID_ARGUMENT", "Servos require numeric pan_deg and tilt_deg");
      return;
    }

    int pan = args["pan_deg"].as<int>();
    int tilt = args["tilt_deg"].as<int>();

    // Safeguard angles to normal structural limits
    pan = constrain(180-pan, 0, 180);
    tilt = constrain(135-tilt, 45, 135);

    servoMotor1.write(pan);
    servoMotor2.write(tilt);

    sendAck(id, "accepted");
    return;
  }

  else {
    sendAck(
      id, "rejected", "INVALID_COMMAND",
      "Unknown command"
    );
  }
}

void readSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      if (!discardingInput) {
        inputBuffer[inputLength] = '\0';

        if (inputLength > 0) {
          handleMessage(inputBuffer);
        }
      }
      inputLength = 0;
      discardingInput = false;
    }
    else if (!discardingInput) {
      if (inputLength < sizeof(inputBuffer) - 1) {
        inputBuffer[inputLength++] = c;
      } else {
        inputLength = 0;
        discardingInput = true;
        stopMotors();
        driveCommandReceived = false;
      }
    }
  }
}

void setup() {
  Serial.begin(115200);

  

  // stopMotors();

  servoMotor1.setPeriodHertz(50);
  servoMotor2.setPeriodHertz(50);

  servoMotor1.attach(Servo1, 500, 2500);
  servoMotor2.attach(Servo2, 500, 2500);
  servoMotor1.write(90);
  servoMotor2.write(90);

  strip.begin();
  strip.setBrightness(128);
  for(int i = 0; i < LED_COUNT; i++) {
    strip.setPixelColor(i, strip.Color(255, 0, 255)); 
  }
  strip.show();

  for (int i = 0; i < 4; i++) {
    pinMode(motors[i].dirPin, OUTPUT);
    pinMode(motors[i].pwmPin, OUTPUT);
    pinMode(i == 0 ? M1_FG :
            i == 1 ? M2_FG :
            i == 2 ? M3_FG : M4_FG, INPUT);

    digitalWrite(motors[i].dirPin, LOW);
    digitalWrite(motors[i].pwmPin, HIGH);
    // attachInterrupt(digitalPinToInterrupt(motors[i].fgPin), isrTable[i], RISING);
  }

  Serial.println("{\"type\":\"ready\"}");
}

void loop() {
  readSerialCommands();

  // 1. Process Core Safe Operational Timers
  if (isTransitioning && (millis() - transitionStartTime >= TRANSITION_DURATION_MS)) {
    isTransitioning = false;
  }

  // 2. Complete the Automated Autonomous Demo Routine
  if (currentMode == MODE_AUTOMATIC && !isTransitioning && !estopLatched) {
  // Automatic routine: Spin on the spot
    setMotor(0,  0.4f); // Left forward vector
    setMotor(1, -0.4f); // Right backward vector
    setMotor(2,  0.4f);
    setMotor(3, -0.4f);
  }

  // 3. Serial Communication Data Watchdog Timeouts
  if (driveCommandReceived && (millis() - lastDriveCommand > COMMAND_TIMEOUT_MS)) {
    stopMotors();
    driveCommandReceived = false;
    Serial.println("{\"type\":\"drive_timeout\"}");
    
  }

  // 4. Update LED Color Space Configurations
  runLightingEngine();

  unsigned long currentMillis = millis();
  
  // 5. Calculate motor speeds
  // Check if 1 second has passed without using delay()
  // if (currentMillis - previousMillis >= interval) {
  //   float dt = (currentMillis - previousMillis) / 1000.0;
  //   previousMillis = currentMillis;
    
  //   // Safely copy and reset the pulse count
  //   double velocities[4] = {0.0, 0.0, 0.0, 0.0};

  //   noInterrupts();
  //   for (int i = 0; i < 4; i++) {
  //     velocities[i] = (double(pulseCounts[i]) / 54.0) * (60.0 / dt);
  //     pulseCounts[i] = 0; 
  //   }
  //   interrupts();
    
  //   char jsonBuffer[128];
  //   snprintf(jsonBuffer, sizeof(jsonBuffer),
  //           "{\"telemetry\":{\"rpm\":[%.2f,%.2f,%.2f,%.2f]}}",
  //           velocities[0], velocities[1], velocities[2], velocities[3]);

  //   Serial.println(jsonBuffer);
  // }
}
