#include <ArduinoJson.h>
#include "protocol.h"
#include "config.h"
#include "motors.h"

char inputBuffer[256];
size_t inputLength = 0;
bool discardingInput = false;

void sendAck(uint32_t id, const char *status, const char *errorCode = nullptr, const char *message = nullptr)
{
    JsonDocument response;
    response["v"] = PROTOCOL_VERSION;
    response["type"] = "ack";
    response["id"] = id;
    response["status"] = status;
    if (errorCode != nullptr)
        response["error"]["code"] = errorCode;
    if (message != nullptr)
        response["error"]["message"] = message;
    serializeJson(response, Serial);
    Serial.println();
}

void sendEvent(const char *eventName)
{
    JsonDocument response;
    response["v"] = PROTOCOL_VERSION;
    response["type"] = "event";
    response["event"] = eventName;
    serializeJson(response, Serial);
    Serial.println();
}

bool isJsonNumber(JsonVariantConst value)
{
    return value.is<int>() || value.is<long>() || value.is<unsigned int>() ||
           value.is<unsigned long>() || value.is<float>() || value.is<double>();
}

void handleMessage(char *message)
{
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);

    if (error)
    {
        sendAck(0, "rejected", "INVALID_JSON", "Invalid JSON");
        return;
    }

    if (doc["v"].isNull() || doc["v"].as<int>() != PROTOCOL_VERSION)
    {
        sendAck(doc["id"] | 0, "rejected", "UNSUPPORTED_VERSION", "Expected protocol version 1");
        return;
    }

    if (!isJsonNumber(doc["id"]))
    {
        sendAck(0, "rejected", "INVALID_ARGUMENT", "Missing or invalid command ID");
        return;
    }

    uint32_t id = doc["id"].as<uint32_t>();
    const char *type = doc["type"] | "";
    const char *cmd = doc["cmd"] | "";
    JsonVariantConst args = doc["args"];

    // Handle direct top-level command shortcuts if sent from frontend
    if (strcmp(type, "drive") == 0)
    {
        // If sent as top-level type: "drive"
        if (estopLatched || currentMode == MODE_INTERACTIVE || isTransitioning || currentMode == MODE_AUTOMATIC)
        {
            stopMotors();
            sendAck(id, "rejected", "LOCKOUT", "Drive blocked by state");
            return;
        }
        float throttle = doc["throttle"] | 0.0f;
        float steering = doc["steering"] | 0.0f;
        setMotor(0, throttle + steering);
        setMotor(1, throttle - steering);
        setMotor(2, throttle + steering);
        setMotor(3, throttle - steering);
        lastDriveCommand = millis();
        driveCommandReceived = true;
        sendAck(id, "accepted");
        return;
    }

    if (strcmp(cmd, "configure") == 0)
    {
        if (args.isNull() || !args["mode"].is<const char *>())
        {
            sendAck(id, "rejected", "INVALID_ARGUMENT", "Configure requires mode");
            return;
        }
        const char *targetModeStr = args["mode"].as<const char *>();
        if (strcmp(targetModeStr, "interactive") == 0)
            currentMode = MODE_INTERACTIVE;
        else if (strcmp(targetModeStr, "manual") == 0)
            currentMode = MODE_MANUAL;
        else if (strcmp(targetModeStr, "automatic") == 0)
            currentMode = MODE_AUTOMATIC;

        if (currentMode == MODE_MANUAL || currentMode == MODE_AUTOMATIC)
        {
            isTransitioning = true;
            transitionStartTime = millis();
            stopMotors();
        }
        else
        {
            isTransitioning = false;
        }
        currentLedAnim = ANIM_STATE_DRIVEN;
        sendAck(id, "accepted");
        return;
    }

    if (strcmp(cmd, "led") == 0)
    {
        if (!args.isNull())
        {
            const char *modeStr = args["mode"] | "state";
            if (strcmp(modeStr, "state") == 0)
                currentLedAnim = ANIM_STATE_DRIVEN;
            else if (strcmp(modeStr, "solid") == 0)
                currentLedAnim = ANIM_SOLID;
            else if (strcmp(modeStr, "wave") == 0)
                currentLedAnim = ANIM_WAVE;
            else if (strcmp(modeStr, "snowflake") == 0)
                currentLedAnim = ANIM_SNOWFLAKE;
            else if (strcmp(modeStr, "circulating") == 0)
                currentLedAnim = ANIM_CIRCULATING;

            const char *hexColor = args["colour"] | "#FFFFFF";
            if (hexColor[0] == '#')
            {
                long rgbNum = strtol(&hexColor[1], NULL, 16);
                customR = (rgbNum >> 16) & 0xFF;
                customG = (rgbNum >> 8) & 0xFF;
                customB = rgbNum & 0xFF;
            }
            if (args["brightness"].is<int>())
            {
                customBrightness = map(constrain(args["brightness"].as<int>(), 0, 100), 0, 100, 0, 255);
            }
            if (args["speed"].is<int>())
                animSpeed = args["speed"].as<int>();
        }
        sendAck(id, "accepted");
        return;
    }

    if (strcmp(cmd, "drive") == 0)
    {
        if (estopLatched || currentMode == MODE_INTERACTIVE || isTransitioning || currentMode == MODE_AUTOMATIC)
        {
            stopMotors();
            sendAck(id, "rejected", "LOCKOUT", "Drive blocked");
            return;
        }
        float fl = args["fl"] | 0.0f;
        float fr = args["fr"] | 0.0f;
        float rl = args["rl"] | 0.0f;
        float rr = args["rr"] | 0.0f;

        setMotor(0, fl);
        setMotor(1, fr);
        setMotor(2, rl);
        setMotor(3, rr);
        lastDriveCommand = millis();
        driveCommandReceived = true;
        sendAck(id, "accepted");
        return;
    }

    if (strcmp(cmd, "stop") == 0)
    {
        stopMotors();
        driveCommandReceived = false;
        sendAck(id, "accepted");
        return;
    }

    if (strcmp(cmd, "estop") == 0)
    {
        stopMotors();
        bool wasLatched = estopLatched;
        estopLatched = true;
        sendAck(id, "accepted");
        if (!wasLatched)
            sendEvent("estop_activated");
        return;
    }

    if (strcmp(cmd, "clear_estop") == 0)
    {
        if (!estopLatched)
        {
            sendAck(id, "accepted");
            return;
        }
        stopMotors();
        estopLatched = false;
        currentMode = MODE_MANUAL;
        isTransitioning = false;
        currentLedAnim = ANIM_STATE_DRIVEN;
        sendAck(id, "accepted");
        sendEvent("estop_cleared");
        return;
    }

    if (strcmp(cmd, "servos") == 0)
    {
        int pan = args["pan_deg"] | 90;
        int tilt = args["tilt_deg"] | 90;
        servoMotor1.write(constrain(180 - pan, 0, 180));
        servoMotor2.write(constrain(135 - tilt, 45, 135));
        sendAck(id, "accepted");
        return;
    }

    sendAck(id, "rejected", "INVALID_COMMAND", "Unknown command");
}

void readSerialCommands()
{
    while (Serial.available() > 0)
    {
        char c = (char)Serial.read();
        if (c == '\r')
            continue;
        if (c == '\n')
        {
            if (!discardingInput && inputLength > 0)
            {
                inputBuffer[inputLength] = '\0';
                handleMessage(inputBuffer);
            }
            inputLength = 0;
            discardingInput = false;
        }
        else if (!discardingInput && inputLength < sizeof(inputBuffer) - 1)
        {
            inputBuffer[inputLength++] = c;
        }
    }
}