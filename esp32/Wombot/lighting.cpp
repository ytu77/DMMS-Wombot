#include "lighting.h"
#include "config.h"

uint32_t Wheel(byte WheelPos)
{
    WheelPos = 255 - WheelPos;
    if (WheelPos < 85)
        return strip.Color(255 - WheelPos * 3, 0, WheelPos * 3);
    if (WheelPos < 170)
    {
        WheelPos -= 85;
        return strip.Color(0, WheelPos * 3, 255 - WheelPos * 3);
    }
    WheelPos -= 170;
    return strip.Color(WheelPos * 3, 255 - WheelPos * 3, 0);
}

void runLightingEngine()
{
    if (estopLatched)
    {
        strip.clear();
        strip.show();
        return;
    }

    unsigned long now = millis();
    unsigned long interval = map(constrain(animSpeed, 1, 100), 1, 100, 150, 10);
    bool tick = (now - lastAnimUpdate >= interval);
    if (tick)
    {
        lastAnimUpdate = now;
        animFrameCounter++;
    }

    if (currentLedAnim != ANIM_STATE_DRIVEN)
    {
        strip.setBrightness(customBrightness);
        if (currentLedAnim == ANIM_SOLID)
        {
            for (int i = 0; i < LED_COUNT; i++)
                strip.setPixelColor(i, strip.Color(customR, customG, customB));
        }
        else if (currentLedAnim == ANIM_WAVE)
        {
            for (int i = 0; i < LED_COUNT; i++)
            {
                strip.setPixelColor(i, Wheel(((i * 256 / LED_COUNT) + animFrameCounter) & 255));
            }
        }
        else if (currentLedAnim == ANIM_SNOWFLAKE)
        {
            for (int i = 0; i < LED_COUNT; i++)
            {
                uint8_t noise = (sin((animFrameCounter + i) * 0.4f) * 40) + 180;
                strip.setPixelColor(i, strip.Color(noise - 40, noise - 20, noise));
            }
        }
        else if (currentLedAnim == ANIM_CIRCULATING)
        {
            strip.clear();
            for (int head = 0; head < 3; head++)
            {
                int pos = (animFrameCounter + (head * (LED_COUNT / 3))) % LED_COUNT;
                strip.setPixelColor(pos, strip.Color(255, 255, 255));
                strip.setPixelColor((pos + 1) % LED_COUNT, strip.Color(200, 200, 200));
                strip.setPixelColor((pos + 2) % LED_COUNT, strip.Color(100, 100, 100));
            }
        }
        strip.show();
        return;
    }

    strip.setBrightness(128);
    if (isTransitioning)
    {
        if (currentMode == MODE_MANUAL)
        {
            for (int i = 0; i < LED_COUNT; i++)
                strip.setPixelColor(i, strip.Color(0, 0, 255));
        }
        else if (currentMode == MODE_AUTOMATIC)
        {
            for (int i = 0; i < LED_COUNT; i++)
                strip.setPixelColor(i, strip.Color(0, 128, 128));
        }
    }
    else
    {
        switch (currentMode)
        {
        case MODE_BOOT:
            for (int i = 0; i < LED_COUNT; i++)
                strip.setPixelColor(i, strip.Color(255, 0, 255));
            break;
        case MODE_INTERACTIVE:
            for (int i = 0; i < LED_COUNT; i++)
                strip.setPixelColor(i, strip.Color(255, 255, 255));
            break;
        case MODE_MANUAL:
            for (int i = 0; i < LED_COUNT; i++)
                strip.setPixelColor(i, strip.Color(0, 0, 255));
            break;
        case MODE_AUTOMATIC:
            for (int i = 0; i < LED_COUNT; i++)
                strip.setPixelColor(i, strip.Color(0, 255, 0));
            break;
        }
    }
    strip.show();
}