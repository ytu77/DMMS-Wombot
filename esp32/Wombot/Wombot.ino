#include "config.h"
#include "motors.h"
#include "lighting.h"
#include "protocol.h"

// Global Object Instances
Motor motors[4] = {
    {M1_DIR, M1_PWM, false},
    {M2_DIR, M2_PWM, false},
    {M3_DIR, M3_PWM, false},
    {M4_DIR, M4_PWM, false}};

Servo servoMotor1;
Servo servoMotor2;
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

RoverMode currentMode = MODE_BOOT;
bool isTransitioning = false;
unsigned long transitionStartTime = 0;
bool estopLatched = false;
bool driveCommandReceived = false;
unsigned long lastDriveCommand = 0;

LedAnimation currentLedAnim = ANIM_STATE_DRIVEN;
uint8_t customR = 255, customG = 255, customB = 255;
uint8_t customBrightness = 128;
uint16_t animSpeed = 50;
unsigned long lastAnimUpdate = 0;
uint16_t animFrameCounter = 0;

void setup()
{
    Serial.begin(115200);

    for (int i = 0; i < 4; i++)
    {
        pinMode(motors[i].dirPin, OUTPUT);
        pinMode(motors[i].pwmPin, OUTPUT);
        pinMode(i == 0 ? M1_FG : i == 1 ? M2_FG
                             : i == 2   ? M3_FG
                                        : M4_FG,
                INPUT);

        digitalWrite(motors[i].dirPin, LOW);
        digitalWrite(motors[i].pwmPin, HIGH);
    }

    // stopMotors();

    servoMotor1.setPeriodHertz(50);
    servoMotor2.setPeriodHertz(50);

    servoMotor1.attach(Servo1, 500, 2500);
    servoMotor2.attach(Servo2, 500, 2500);
    servoMotor1.write(90);
    servoMotor2.write(90);

    strip.begin();
    strip.setBrightness(128);
    for (int i = 0; i < LED_COUNT; i++)
    {
        strip.setPixelColor(i, strip.Color(255, 0, 255));
    }
    strip.show();

    Serial.println("{\"type\":\"ready\"}");
}

void loop()
{
    readSerialCommands();

    // 1. Process Core Safe Operational Timers
    if (isTransitioning && (millis() - transitionStartTime >= TRANSITION_DURATION_MS))
    {
        isTransitioning = false;
    }

    // 2. Complete the Automated Autonomous Demo Routine
    if (currentMode == MODE_AUTOMATIC && !isTransitioning && !estopLatched)
    {
        // Automatic routine: Spin on the spot
        setMotor(0, 0.4f);  // Left forward vector
        setMotor(1, -0.4f); // Right backward vector
        setMotor(2, 0.4f);
        setMotor(3, -0.4f);
    }

    // 3. Serial Communication Data Watchdog Timeouts
    if (driveCommandReceived && (millis() - lastDriveCommand > COMMAND_TIMEOUT_MS))
    {
        stopMotors();
        driveCommandReceived = false;
        Serial.println("{\"type\":\"drive_timeout\"}");
    }

    // 4. Update LED Color Space Configurations
    runLightingEngine();
}
