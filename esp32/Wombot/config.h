#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include <ESP32Servo.h>
#include <Adafruit_NeoPixel.h>

// Hardware Pin Definitions
#define LED_PIN 21
#define LED_COUNT 60

const int M1_DIR = 26;
const int M1_PWM = 19;
const int M1_FG = 34;
const int M2_DIR = 25;
const int M2_PWM = 12;
const int M2_FG = 35;
const int M3_DIR = 33;
const int M3_PWM = 14;
const int M3_FG = 39;
const int M4_DIR = 32;
const int M4_PWM = 27;
const int M4_FG = 36;

const int Servo1 = 22;
const int Servo2 = 23;

struct Motor
{
    int dirPin;
    int pwmPin;
    bool invertDirection;
};

extern Motor motors[4];
extern Servo servoMotor1;
extern Servo servoMotor2;
extern Adafruit_NeoPixel strip;

// Protocol & States
const uint8_t PROTOCOL_VERSION = 1;
enum RoverMode
{
    MODE_BOOT,
    MODE_INTERACTIVE,
    MODE_MANUAL,
    MODE_AUTOMATIC
};
extern RoverMode currentMode;

extern bool isTransitioning;
extern unsigned long transitionStartTime;
constexpr unsigned long TRANSITION_DURATION_MS = 3000;

extern bool estopLatched;
extern bool driveCommandReceived;
extern unsigned long lastDriveCommand;
constexpr unsigned long COMMAND_TIMEOUT_MS = 300000;

// Lighting Variables
enum LedAnimation
{
    ANIM_STATE_DRIVEN,
    ANIM_SOLID,
    ANIM_WAVE,
    ANIM_SNOWFLAKE,
    ANIM_CIRCULATING
};
extern LedAnimation currentLedAnim;

extern uint8_t customR, customG, customB;
extern uint8_t customBrightness;
extern uint16_t animSpeed;
extern unsigned long lastAnimUpdate;
extern uint16_t animFrameCounter;

#endif