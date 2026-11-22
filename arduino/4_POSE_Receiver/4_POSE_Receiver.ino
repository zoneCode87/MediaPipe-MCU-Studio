/*
 * [4: POSE MODEL] MediaPipe-MCU-Studio -> Arduino / ESP32 Serial Receiver
 * Packet Format: "PD:1,EL:160,ER:90,SL:45,SR:110,WD:250,AR:01\n"
 *   PD = Body Detected Boolean (1 = True / 0 = False)
 *   EL = Left Elbow Angle (0..180 deg)
 *   ER = Right Elbow Angle (0..180 deg)
 *   SL = Left Shoulder Elevation Angle (0..180 deg)
 *   SR = Right Shoulder Elevation Angle (0..180 deg)
 *   WD = Wrists Distance (px)
 *   AR = Hands Raised State [LeftArm, RightArm] ("11"=Both Up, "00"=Both Down)
 */

bool bodyDetected = false;
int leftElbow = 0;
int rightElbow = 0;
int leftShoulder = 0;
int rightShoulder = 0;
int wristsDist = 0;
String armsState = "00";

void setup() {
  Serial.begin(115200);
  Serial.println("MCU_READY: Waiting for MediaPipe POSE Data...");
}

String getValue(String data, String key) {
  int start = data.indexOf(key + ":");
  if (start == -1) return "";
  start += key.length() + 1;
  int end = data.indexOf(",", start);
  if (end == -1) end = data.length();
  return data.substring(start, end);
}

void loop() {
  if (Serial.available() > 0) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    String bodyStr  = getValue(line, "PD");
    String elLStr   = getValue(line, "EL");
    String elRStr   = getValue(line, "ER");
    String shLStr   = getValue(line, "SL");
    String shRStr   = getValue(line, "SR");
    String wDistStr = getValue(line, "WD");
    String armsStr  = getValue(line, "AR"); // e.g. "00", "10", "01", "11"
  } 
}
