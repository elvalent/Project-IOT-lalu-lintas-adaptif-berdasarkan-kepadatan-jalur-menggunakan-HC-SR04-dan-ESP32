// Pengatur Lalu Lintas Adaptif - ESP32 + 2 HC-SR04 + MQTT
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

const char* BROKER = "broker.hivemq.com";
const char* T_DATA = "lalin-adaptif-kiel-2026-7f3a/data";
const char* T_CMD  = "lalin-adaptif-kiel-2026-7f3a/cmd";
const char* T_ACK  = "lalin-adaptif-kiel-2026-7f3a/ack";
#define TRIG_A 5
#define ECHO_A 18
#define TRIG_B 19
#define ECHO_B 21
const int LED_A[3] = {25, 26, 27}; // merah, kuning, hijau
const int LED_B[3] = {23, 22, 4};
const float RANGE_CM = 200.0f;
const int MIN_G = 5, MAX_G = 20, YEL = 2, ALLRED = 1;

WiFiClient wifi; PubSubClient mqtt(wifi);
int dA=20,dB=20,cA=160,cB=160;
int phase=0,sA=2,sB=0; // 0 hijau A,1 kuning A,2 all-red,3 hijau B,4 kuning B,5 all-red
unsigned long phaseEnd=0,lastRead=0,lastPub=0,lastService=0,lastTry=0;
String mode="AUTO";
int lastGreen=1; // tie-break: 1 berarti terakhir A, 0 berarti terakhir B

float readDist(int trig,int echo){
 digitalWrite(trig,LOW);delayMicroseconds(2);digitalWrite(trig,HIGH);delayMicroseconds(10);digitalWrite(trig,LOW);
 long t=pulseIn(echo,HIGH,30000);return t?min(RANGE_CM,t*0.034f/2.0f):RANGE_CM;
}
int density(float cm){return constrain((int)((RANGE_CM-cm)/RANGE_CM*100.0f),0,100);}
int greenTime(int d){return MIN_G+(MAX_G-MIN_G)*constrain(d,0,100)/100;}
void applySignal(){for(int i=0;i<3;i++){digitalWrite(LED_A[i],i==sA);digitalWrite(LED_B[i],i==sB);}}
void startPhase(int p){
 phase=p;int dur=ALLRED;
 switch(p){
  case 0:sA=2;sB=0;dur=greenTime(dA);lastGreen=1;break;
  case 1:sA=1;sB=0;dur=YEL;break;
  case 2:sA=0;sB=0;dur=ALLRED;break;
  case 3:sA=0;sB=2;dur=greenTime(dB);lastGreen=0;break;
  case 4:sA=0;sB=1;dur=YEL;break;
  default:sA=0;sB=0;dur=ALLRED;break;
 }
 phaseEnd=millis()+(unsigned long)dur*1000UL;lastService=millis();applySignal();
}
void chooseNextGreen(){
 // Prioritaskan jalur dengan kepadatan lebih tinggi. Jika sama, bergantian.
 if(dA>dB)startPhase(0);else if(dB>dA)startPhase(3);else startPhase(lastGreen?3:0);
}
void onMsg(char* topic,byte* payload,unsigned int len){
 String cmd;for(unsigned int i=0;i<len;i++)cmd+=(char)payload[i];cmd.trim();cmd.toUpperCase();
 if(cmd=="AUTO"){mode="AUTO";chooseNextGreen();}
 else if(cmd=="FORCE_A"){mode=cmd;sA=2;sB=0;phase=-1;applySignal();}
 else if(cmd=="FORCE_B"){mode=cmd;sA=0;sB=2;phase=-1;applySignal();}
 else if(cmd=="ALL_RED"){mode=cmd;sA=0;sB=0;phase=-1;applySignal();}
 else {mqtt.publish(T_ACK,("FAIL:"+cmd).c_str());return;}
 mqtt.publish(T_ACK,("OK:"+cmd).c_str());
}
void reconnect(){
 if(WiFi.status()!=WL_CONNECTED||millis()-lastTry<3000)return;lastTry=millis();
 String id="esp32-lalin-"+String((uint32_t)ESP.getEfuseMac(),HEX);
 Serial.print("MQTT connect... ");
 if(mqtt.connect(id.c_str())){mqtt.subscribe(T_CMD);Serial.println("connected");}
 else{Serial.print("failed state=");Serial.println(mqtt.state());}
}
void setup(){
 Serial.begin(115200);pinMode(TRIG_A,OUTPUT);pinMode(ECHO_A,INPUT);pinMode(TRIG_B,OUTPUT);pinMode(ECHO_B,INPUT);
 for(int i=0;i<3;i++){pinMode(LED_A[i],OUTPUT);pinMode(LED_B[i],OUTPUT);}
 WiFi.mode(WIFI_STA);WiFi.begin("Wokwi-GUEST", "", 6);
 Serial.print("WiFi");while(WiFi.status()!=WL_CONNECTED){delay(300);Serial.print(".");}Serial.println(" connected");
 mqtt.setServer(BROKER,1883);mqtt.setCallback(onMsg);mqtt.setBufferSize(512);mqtt.setKeepAlive(30);mqtt.setSocketTimeout(5);
 cA=(int)readDist(TRIG_A,ECHO_A);cB=(int)readDist(TRIG_B,ECHO_B);dA=density(cA);dB=density(cB);chooseNextGreen();
}
void loop(){
 if(WiFi.status()==WL_CONNECTED){if(!mqtt.connected())reconnect();else mqtt.loop();}
 unsigned long now=millis();
 if(now-lastRead>=500){lastRead=now;cA=(int)readDist(TRIG_A,ECHO_A);cB=(int)readDist(TRIG_B,ECHO_B);}
 if(mode=="AUTO"){
  if(now-lastService>=1000){lastService=now;int targetA=density(cA),targetB=density(cB);if(phase==0)dA=max(0,dA-2);else if(dA<targetA)dA++;else if(dA>targetA)dA--;if(phase==3)dB=max(0,dB-2);else if(dB<targetB)dB++;else if(dB>targetB)dB--; }
  if((long)(now-phaseEnd)>=0){switch(phase){case 0:startPhase(1);break;case 1:startPhase(2);break;case 2:chooseNextGreen();break;case 3:startPhase(4);break;case 4:startPhase(5);break;default:chooseNextGreen();break;}}
 }
 if(now-lastPub>=1000){lastPub=now;int rem=(mode=="AUTO"&&phaseEnd>now)?(phaseEnd-now+999)/1000:0;char msg[180];
  snprintf(msg,sizeof(msg),"{\"dA\":%d,\"dB\":%d,\"cA\":%d,\"cB\":%d,\"ph\":%d,\"sA\":%d,\"sB\":%d,\"rem\":%d,\"mode\":\"%s\"}",dA,dB,cA,cB,phase,sA,sB,rem,mode.c_str());
  if(mqtt.connected())mqtt.publish(T_DATA,msg);Serial.println(msg);
 }
}
