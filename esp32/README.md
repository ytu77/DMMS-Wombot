# DMMS-Wombot — ESP32 Motor & Sensor Node

This directory contains the firmware for the **ESP32 Microcontroller** powering the DMMS-Wombot robot. The ESP32 serves as the lower-level hardware controller, managing motor drivers, wheel encoders, sensor telemetry, and serial communications with the Raspberry Pi host. The contents of DMMS_teleop are the scripts that run on the ESP32 currently through Arduino IDE and have been tested to work. The contents of Wombot are supposed to be the same as DMMS_teleop except for being organised into different files to make it easier to navigate. However, the code has not been properly tested like the one in DMMS_teleop, so it may need some troubleshooting.

---

## 🛠 Target Hardware & Specs

- **Microcontroller:** ESP32 Development Board (ESP32-WROOM-32 / 38-pin or 30-pin variant)
- **Architecture:** Xtensa dual-core 32-bit LX6 @ 240 MHz
- **Connectivity:**
  - Hardware UART (Serial0/Serial2) for high-speed bi-directional telemetry with the Raspberry Pi host.
  - Built-in Wi-Fi / Bluetooth (Optional debugging fallback).
- **Peripherals Driven:**
  - Dual H-Bridge Motor Driver (e.g., L298N, TB6612FNG, or Cytron MDD10) via PWM outputs.
  - Quadrature Wheel Encoders (using Hardware Interrupt pins).
  - Status LEDs and auxiliary sensor inputs (IMU / Ultrasonic sensors if equipped).

---

## ⚙️ Setting Up Arduino IDE

### 1. Install Arduino IDE

Ensure you have **Arduino IDE 2.x** (or 1.8.x) installed on your development machine.

### 2. Install ESP32 Board Support

1. Open Arduino IDE and navigate to **File > Preferences** (or `Cmd + ,` on macOS).
2. In the **Additional Boards Manager URLs** field, paste the following URL:
   ```text
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Open the Boards Manager (**Tools > Board > Boards Manager...**).
4. Search for `esp32` by **Espressif Systems** and click **Install**.

### 3. Select Target Board and Port

1. Plug your ESP32 board into your computer via a Micro-USB or USB-C data cable.
2. Select your board under **Tools > Board > esp32 > ESP32 Dev Module**.
3. Select your serial port under **Tools > Port** (e.g., `COMx` on Windows, `/dev/ttyUSB0` or `/dev/tty.usbserial-*` on Linux/macOS).

### 4. Required Libraries

Install the following libraries via the Arduino Library Manager (**Tools > Manage Libraries...**):

- **ArduinoJson** (v6.x or v7.x) — For structured JSON telemetry commands.
- _(Optional)_ **Adafruit MPU6050** / **Adafruit BusIO** — If using an onboard IMU module.

---

## 🛰 System Architecture & How It Works

```
 +------------------------+                  +------------------------+
 |                        |   UART Serial    |                        |
 |     Raspberry Pi       |<---------------->|         ESP32          |
 | (FastAPI / Web Interface)                 | (Real-time Hardware)   |
 +------------------------+                  +------------------------+
                                                         |
                                        +----------------+----------------+
                                        |                                 |
                                        v                                 v
                               +----------------+                +----------------+
                               |  Motor Drivers |                | Wheel Encoders |
                               +----------------+                +----------------+
```

1. **Serial Communication Loop:**
   - The ESP32 listens continuously on its UART RX line for incoming JSON or formatted string packets sent by the Raspberry Pi Python backend (`main.py`).
   - Packets specify targeted linear and angular velocity commands (e.g., `{"drive": {"left": 180, "right": 180}}`).

2. **PWM Motor Control:**
   - Incoming velocity targets are mapped to PWM duty cycles via ESP32 `ledc` PWM channels and applied directly to motor driver directional control pins.

3. **Encoder Telemetry & Feedback:**
   - High-frequency pulse counts from motor encoders are captured via GPIO interrupts (`attachInterrupt`).
   - The ESP32 computes tick counts and estimates wheel velocities, sending real-time health and position telemetry back to the Raspberry Pi over UART.

---

## 🚀 Flashing the ESP32

1. Open the `.ino` sketch (e.g., `esp32_wombot.ino`) in Arduino IDE.
2. Verify configuration constants near the top of the file:
   ```cpp
   #define BAUD_RATE 115200
   #define MOTOR_LEFT_PWM  25
   #define MOTOR_RIGHT_PWM 26
   // Adjust pin assignments to match your wiring schematic
   ```
3. Click the **Upload** button (Right arrow icon).
   - _Note:_ If the IDE hangs at `Connecting...`, press and hold the **BOOT** button on your ESP32 board until the flashing progress bar begins.

---

## 🔍 Testing & Debugging

1. Open the **Serial Monitor** (**Tools > Serial Monitor**) and set the baud rate to **115200**.
2. Reset the ESP32 using its physical **EN / RST** button.
3. You should observe initial boot messages followed by periodic output strings confirming sensor readouts and ready states.
