#include "motors.h"
#include "config.h"

void setMotor(int index, float command)
{
    command = constrain(command, -1.0f, 1.0f);
    Motor &m = motors[index];
    bool forward = command >= 0.0f;
    if (m.invertDirection)
        forward = !forward;

    int pwm = 255 - (int)(fabsf(command) * 254.0f + 0.5f);
    if (pwm == 0)
    {
        digitalWrite(m.pwmPin, LOW);
        return;
    }

    digitalWrite(m.dirPin, forward ? HIGH : LOW);
    analogWrite(m.pwmPin, pwm);
}

void stopMotors()
{
    for (int i = 0; i < 4; i++)
    {
        digitalWrite(motors[i].pwmPin, HIGH);
    }
}