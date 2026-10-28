---
title: "差分ROS自主导航小车"
---
# 差分ROS自主导航小车

# 整体框架：分层架构

![1.00](/images/%E9%A1%B9%E7%9B%AE%E7%BB%8F%E5%8E%86/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE/2026-10-12T11-53-07-547Z-77696011-bingda_%E5%B7%AE%E9%80%9FROS%E5%B0%8F%E8%BD%A6_%E7%B3%BB%E7%BB%9F%E5%88%86%E5%B1%82%E6%9E%B6%E6%9E%84.png)

# 硬件设施

![1.00](/images/%E9%A1%B9%E7%9B%AE%E7%BB%8F%E5%8E%86/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE/2026-10-12T12-45-15-437Z-156e0afe-image.png)

![1.00](/images/%E9%A1%B9%E7%9B%AE%E7%BB%8F%E5%8E%86/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE/2026-10-13T03-08-50-143Z-8d77b848-%E4%B8%80%E4%BB%A3%E5%9B%9B%E9%A9%B1%E9%A9%B1%E5%8A%A8%E6%9D%BF%E6%8E%A5%E5%8F%A3%E8%AF%A6%E8%A7%A3%E5%9B%BE.png)

## 一、整体构成

硬件分三块：**底盘（机械）→ 主控板（电气）→ 上位机（算力）**。
主控板型号 **ALL\_IN\_ONE\_COMMON\_V4**，厂商冰达智能（深圳）。

```
┌──────────────┐        ┌────────────────────┐        ┌──────────────┐
│   底盘机械    ｜◀──────▶│  Nano 四驱主控板    │◀──USB──▶│   上位机      │
│   4× 电机    ｜ 6pin   │  STM32F303RxT6     │ 串口    │   树莓派 /    │
│   4× 编码器   │  接口   │  ALL_IN_ONE_V4    │         │   Jetson Nano│
│   12.6V 锂电  │        │  4× AT8236 驱动    │        │    Ubuntu+ROS │
└──────────────┘        └────────────────────┘        └──────────────┘
```

**关键设计理念**（PPT 原话）：*"公司系列产品共用一个主控"* —— 无论双电机的 NanoCar / NanoRobot，还是四电机的 NanoOmni/Crab，甚至无刷 Panda 系列，**都用这块板**，靠固件的 `BASE_TYPE` + 拨码开关适配。

***

## 二、底盘（机械部分）

### 2.1 基本形态

* **全封闭结构两驱底盘**，主要部件：电池、电机、编码器、IMU、电机控制板
* 内置 **12.6V 动力锂电池（3S）**，面板左侧第一个圆孔 DC 充电口
* 立柱 + 亚克力层板 + 笔记本支架，顶层可装雷达、乐视 Astra Pro 深度相机

### 2.2 电机与编码器

| 项         | 25GA370                | 37GB520                |
| --------- | ---------------------- | ---------------------- |
| 减速比       | 20 : 1                 | 30 : 1                 |
| 空载转速      | 6000 rpm               | 10000 rpm              |
| 编码器线数 PPR | 11                     | 11                     |
| 四倍频后分辨率   | 11×4×20 =**880 计数/圈**  | 11×4×30 =**1320 计数/圈** |
| 对应车型      | NanoRobot / NanoCar（小） | 4WD / NanoCar\_Pro（大）  |

编码器为**增量式正交编码器**，接在电机接口的 `C1` / `C2` 两脚上。

### 2.3 轮系几何参数（`Config.h`）

| 车型                | 轮距`WHEEL_TREAD` | 轴距`WHEEL_BASE` | 轮径`WHEEL_DIAMETER` |
| ----------------- | --------------- | -------------- | ------------------ |
| NanoRobot（2WD 差速） | 0.171 m         | 0.150 m        | **0.065 m**        |
| NanoCar（阿克曼）      | 0.158 m         | 0.1445 m       | 0.064 m            |
| NanoCar 差速模式      | 0.158 m         | 0.1445 m       | 0.064 m            |
| 4WD（注释中，未启用）      | 0.225 m         | 0.214 m        | 0.080 m            |

> 这几个参数**直接决定里程计准不准**。原地转 360° 反推实际轮距，是标定的第一步。

### 2.4 电机接口（每个电机 6 pin）

```
电机1 接口：  1B   5V   C2   C1   G   1A
              │    │    │    │    │   │
              └────┴────┴────┴────┴───┘
              电机- 编码器电源  编码器A/B  电机+
```

* `xA` / `xB`：电机两端（接驱动板 H 桥输出）
* `5V` / `G`：编码器供电与地
* `C1` / `C2`：正交编码器 A 相 / B 相

***

## 三、主控板

### 3.1 电源链

```
3S 锂电 9–12.6V/5A
   │
   ├─ 5A 一次性保险          ← 防意外短路
   ├─ MOS 防反接             ← 比二极管损耗更小
   ├─ 输入 TVS（SMF5.0A）     ← 吸收电机产生的尖峰
   │
   ├─► SY8105 降压 ──► 5V-5A 主电源 ─┐
   │                                 ├─► 给树莓派 / Jetson Nano 供电
   │   SY8105 降压 ──► 5V-5A 副电源 ─┘   （双独立电源，输出实际 5.1–5.2V 补压降）
   │
   └─► LDO + 磁珠 ──► 3.3V-200mA ──► STM32 等

另有一路 12V-5A 输出（面板），钮子开关控制整板通断
```

设计要点：

* **双路独立 5V**（主 + 副），驱动能力各 5A
* 5V 输出加 **TVS** 防浪涌，并**独立 LED** 直观观察 5V 是否正常
* **电机 12V 与 MCU 3.3V/5V 严格分区**，避免电机干扰数字电路
* 电源芯片从老的 `MP2380` 换成 `SY8105`（体积更小、发热更低）

### 3.2 主控 MCU

| 项  | 值                                   |
| -- | ----------------------------------- |
| 型号 | **STM32F303RxT6**（Cortex-M4F，带硬件浮点） |
| 主频 | 72 MHz（8 MHz 晶振）                    |
| 供电 | 3.3V                                |
| 调试 | 四线 SWD，烧写口用**3.3V**（切勿引入 5V）        |

### 3.3 电机驱动（四路独立）

| 项    | 值                                                                |
| ---- | ---------------------------------------------------------------- |
| 驱动芯片 | **AT8236**（早期为 HR8833，更早为 TB6612）                                |
| 工作电压 | 5.5 – 36 V                                                       |
| 输出能力 | **6A 峰值 / 4A 连续**                                                |
| 保护   | 过流、短路、欠压锁定、过温                                                    |
| 控制方式 | **1 路 PWM + 1 路方向 GPIO**，经 **74HC00 + 模拟开关** 切换 AT8236 的 IN1/IN2 |

> ⚠️ **这是这块板最巧妙的一处设计**：常规做法是每个电机占 2 路 PWM（IN1/IN2），四路就要 8 路 PWM。
> 这里用模拟开关把 1 路 PWM 路由到 IN1 或 IN2，**方向由 GPIO 决定** —— 四个电机只占 4 路 PWM + 4 路 GPIO。
> 代价是 PWM **反相**：`__HAL_TIM_SET_COMPARE(..., 999 - |pwm|)`，占空比 999 = 停，0 = 全速。

四路电机共用 **TIM2** 的 4 个通道：

| 电机     | PWM 通道    | 方向 GPIO |
| ------ | --------- | ------- |
| MOTOR1 | TIM2\_CH3 | PC2     |
| MOTOR2 | TIM2\_CH4 | PC3     |
| MOTOR3 | TIM2\_CH1 | PC0     |
| MOTOR4 | TIM2\_CH2 | PC1     |

> 📌 **需要你核实的点**：这份固件（`Car_Robot` 变体）在控制环里**只驱动 M1 / M2**，M3 / M4 的调用被注释掉了
> （`mainloop.c` 里 `vGetMotorSpeed(&xMotor3)` / `vExecuteMotorSpeed(&xMotor3,...)` 均为注释）。
> 如果你的底盘是四驱，要么 M3/M4 与 M1/M2 **硬件并联**，要么就得改固件把四路打开。**接线时务必确认。**

### 3.4 编码器接口（四路）

| 项    | 值                                                             |
| ---- | ------------------------------------------------------------- |
| 方式   | STM32 定时器**编码器模式**，硬件正交解码 + 四倍频                               |
| 定时器  | ENCODER1=TIM4 · ENCODER2=TIM1 · ENCODER3=TIM3 · ENCODER4=TIM8 |
| 计数上限 | `ENCODER_TIM_PERIOD = 50000`                                  |
| 溢出处理 | `HAL_TIM_PeriodElapsedCallback` 里按计数方向 ±1，总值 = 溢出次数×周期 + 当前计数 |

用硬件编码器模式而不是外部中断，好处是**高转速下不会因中断过密而丢脉冲**，且 CPU 零开销。

### 3.5 IMU 模块

| 项     | 值                                         |
| ----- | ----------------------------------------- |
| 形式    | **独立模块**，通过 **FPC 排线**连接（旧版是直接焊接，新版改可换位置） |
| 接口    | **UART2**（`G TX2 RX2 5V`）                 |
| 最大上报率 | **200 Hz**                                |
| 输出内容  | 欧拉角（Pitch/Roll/Yaw）、原始 Gyro/Accel、四元数、温度  |
| 固件处理  | 5 点滑动平均滤波`fGyroZ`；连接建立时自动触发一次校准           |

常见模块型号（芯片手册里都有）：`ICM-42688-P` / `ICM-20948` / `MPU9250`。

### 3.6 电流 / 电压采样

| 项    | 器件                    | 说明                                                |
| ---- | --------------------- | ------------------------------------------------- |
| 双向电流 | **INA199**（早期 INA193） | 采样电阻`CURRENT_RES = 0.01Ω`，放大 `CURRENT_SCALE = 20` |
| 电池电压 | ADC1（`ADC_CHANNEL_1`） | 分压`R1=47kΩ / R2=10kΩ`                             |
| 板型识别 | ADC（`LEVEL` = PF4）    | 硬件版本自动识别                                          |

> INA199 相比 INA193 的优势：**体积更小 + 能测双向电流**（充放电都能测），对应面板上的"双向电流采样"。

### 3.7 指示与交互

| 器件                 | 驱动方式                        | 引脚   |
| ------------------ | --------------------------- | ---- |
| **WS2812 RGB 全彩灯** | 单线协议，MOS 驱动，**留对外扩展口**可串更多灯 | PA10 |
| 蜂鸣器                | MOS 驱动，PWM 调音               | PC8  |
| 风扇                 | MOS 驱动                      | PC9  |
| 用户按键               | 一路，用于升级等特殊交互                | PB2  |

灯语（固件 `Indicate.c`）：

| 现象                | 含义                |
| ----------------- | ----------------- |
| 绿灯 0.5Hz（慢闪）      | 待机：功能正常，未与上位机建立连接 |
| 绿灯 2Hz（快闪）        | 联机：已建立连接          |
| 蓝灯 2Hz + 蜂鸣 1Hz   | 低电压报警             |
| 红灯 0.5Hz + 蜂鸣 1Hz | IMU 初始化异常，需重启     |

### 3.8 通信接口

| 接口         | 用途                       | 备注                                 |
| ---------- | ------------------------ | ---------------------------------- |
| **UART1**  | **主通讯**（接上位机）            | DMA + IDLE 中断收发；115200 8N1         |
| UART2      | IMU 模块                   | —                                  |
| UART3      | 复用为**CAN 口**             | CANH / CANL / R3 / T3              |
| UART4      | 副串口（`5V RX4 TX4 G`）      | 扩展备用                               |
| UART5      | 调试打印（`printf` 重定向）       | 固件里`fputc` 指向 UART5                |
| **原生 USB** | 备用通讯（CDC 虚拟串口）           | 差分布线、1.5K 上拉，**5V 与整板隔离**防止上位机反向供电 |
| **CAN**    | CAN 2.0B，最高 1 Mbit/s     | **120Ω 终端电阻跳线**（2.0 1×2 排针跳帽）      |
| **PS2**    | 标准 PS2 无线手柄              | 也可当**SPI** 用；引脚 PA4–PA7            |
| 舵机 ×4      | `S1–S4` + 5V/GND         | PB12–PB15                          |
| 超声波 ×2     | SR04 接口                  | TRIG PB11/PC10，ECHO PB10（EXTI）     |
| 拨码开关 ×2    | 车型 / 电机类型选择              | PC13 / PC14                        |
| 调试口        | ST-LINK（CLK / DIO / 3V3） | 做成可换插件式                            |

> ⚠️ PPT 明确提醒：**"所有 IO 口均为直连，不能用于要求较高的场合，以免 IO 口损坏"** —— 外接设备要注意电平与防护。

***

## 四、引脚分配总表（`main.h`）

| 功能           | 引脚               | 功能                | 引脚          |
| ------------ | ---------------- | ----------------- | ----------- |
| MOTOR1 PWM   | PA2              | MOTOR1 方向         | PC2         |
| MOTOR2 PWM   | PA3              | MOTOR2 方向         | PC3         |
| MOTOR3 PWM   | PA0              | MOTOR3 方向         | PC0         |
| MOTOR4 PWM   | PA1              | MOTOR4 方向         | PC1         |
| WS2812       | PA10             | 蜂鸣器               | PC8         |
| PS2\_DI      | PA4              | 风扇                | PC9         |
| PS2\_DO      | PA5              | 拨码 SWITCH1        | PC13        |
| PS2\_CS      | PA6              | 拨码 SWITCH2        | PC14        |
| PS2\_CLK     | PA7              | CAN\_STB          | PC15        |
| 电流采样 CURRENT | PB0              | 按键 KEY\_1         | PB2         |
| 电压采样 VOLTAGE | PB1              | 板型识别 LEVEL        | PF4         |
| 舵机 SIG1–4    | PB12–PB15        | 超声波 TRIG1 / TRIG2 | PC11 / PC10 |
| 超声波 ECHO     | PB10（EXTI15\_10） | 超声波 SR04\_TRIG\_1 | PB11        |

定时器分配：`TIM1/3/4/8` = 四路编码器 · `TIM2` = 四路电机 PWM。

***

## 五、硬件版本演进（PPT 第 26–30 页）

| 变更                               | 原因                         |
| -------------------------------- | -------------------------- |
| 电源芯片`MP2380` → `SY8105`          | 停产 + 体积，新片体积更小、发热更低        |
| 驱动`TB6612` → `HR8833` / `AT8236` | 2019 年 TB6612 突然缺货、价格飞涨    |
| 电流采样`INA193` → `INA199`          | 体积缩小 + 支持双向电流              |
| IMU 直焊 →**FPC 排线**               | 方便改变安装位置                   |
| 烧写口 → 可换插件式                      | 便于扩展                       |
| 增加一路 5V 电源                       | 更强驱动能力                     |
| **取消排针通讯，改用 XH 转杜邦线**            | 兼容树莓派 / Jetson Nano 等不同上位机 |
| **全部串口、USB、CAN 引出**              | 便于二次开发                     |
| 设计为**4 路驱动**                     | 极大增加应用场合                   |

***

## 六、上手前的注意事项

1. **充电口是面板最左侧第一个圆孔**，插中间两个 DC 口充不进电，且可能烧保险丝
2. **长期存放**要把电池放到 **11.4–11.7V**，充满或低压存放超 5 天会鼓包
3. **低电压报警（<10.8V）应立即停止使用**，避免过放损坏电池
4. **烧写口用 3.3V**，不要引入 5V
5. **电机接口中间两脚是编码器**，插反了会导致测速异常
6. 底盘**不要无人看守充电**，不要放在易燃物附近
7. 麦克纳姆轮**有方向之分**，装反会导致运动方向错误（差速轮无此问题）

***

## 七、与软件侧的对应关系

| 硬件           | 固件模块                        | 上位机               |
| ------------ | --------------------------- | ----------------- |
| 4× 电机 + 编码器  | `Motor.c` + `bsp_encoder.c` | `/odom` 话题        |
| IMU（UART2）   | `uart_imu.c`                | `/imu` 话题         |
| INA199 + ADC | `Battery.c`                 | `/battery` 话题     |
| UART1 主通讯    | `Communication.c`           | `base_control.py` |
| WS2812 + 蜂鸣器 | `Indicate.c`                | —（灯语即日志）          |
| 拨码 SW1/SW2   | `vSetKinematicsConfig()`    | 环境变量`BASE_TYPE`   |
| 超声波 ×2       | `Sonar.c`                   | `/sonar_1..4`     |
| PS2 手柄       | `PS2.c`                     | —（第二控制源）          |
| 舵机 ×4        | `Servo.c`                   | —（阿克曼转向）          |

# STMtoROS串口通信

![1.00](/images/%E9%A1%B9%E7%9B%AE%E7%BB%8F%E5%8E%86/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE/2026-10-12T13-20-31-262Z-c88f7b4c-image.png)

![1.00](/images/%E9%A1%B9%E7%9B%AE%E7%BB%8F%E5%8E%86/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE/2026-10-12T13-24-40-817Z-11411b0a-image.png)

## 一、协议设计

### 1.1 帧格式

```
 0      1       2      3        4..N       N+1     N+2
┌──────┬───────┬──────┬───────┬─────────┬───────┬───────┐
│ 帧头  │ 帧长度 │  ID  │ 功能码 │  数据    │ 预留位 │  CRC  │
│ 0x5A │ 1 Byte│ 0x01 │ 1 Byte│ 0~250 B │ 0x00  │ 1 Byte│
└──────┴───────┴──────┴───────┴─────────┴───────┴───────┘
                └─────── 帧长度 = 整帧字节数 ───────┘
                └──────── CRC 覆盖范围 ────────┘
```

| 字段  | 说明                            |
| --- | ----------------------------- |
| 帧头  | 固定`0x5A`，拆包时的同步标志             |
| 帧长度 | **整帧**字节数（帧头→CRC），最大 255      |
| ID  | 下位机编号，本车`0x01`，为级联预留          |
| 功能码 | **上位机→下位机 = 奇数，下位机→上位机 = 偶数** |
| 数据  | 大端序（MSB 在前），定点缩放              |
| 预留位 | 固定`0x00`，扩展预留                 |
| CRC | CRC-8/MAXIM，**`0xFF` = 跳过校验** |

### 1.2 三条设计约定（很重要）

1. **奇偶功能码分方向** —— 抓包时一眼判方向，不用查表
2. **帧长自带** —— 数据里可以是任意字节，不需要转义，比"帧尾字节"方案健壮
3. **ID + 预留位** —— 为多底盘级联和协议升级留了口子

### 1.3 定点缩放

所有物理量都乘一个系数转成整数，避免在 MCU 上跑浮点通信：

| 量   | 缩放     | 类型     | 例      |
| --- | ------ | ------ | ------ |
| 线速度 | <br /> | <br /> | <br /> |

| <br />  | <br /> | <br /> | <br />                  |
| ------- | ------ | ------ | ----------------------- |
| <br />  | 1000   | int16  | 0.5 m/s → 500 →`0x01F4` |
| 角速度     | 1000   | int16  | 1.2 rad/s → 1200        |
| 角度      | 100    | int16  | 90.5° → 9050            |
| 电压/电流   | 1000   | uint16 | 12.6V → 12600           |
| 陀螺仪/加速度 | 100000 | int32  | —                       |
| 四元数     | 10000  | int16  | —                       |

***

## 二、STM32 端实现

### 2.1 整体架构：四级流水线

```
硬件串口
   │  DMA 搬运
   ▼
①  IDLE 中断         ── 判定"一帧数据收完了"
   │  memcpy
   ▼
②  环形缓冲（512B）   ── 生产者：ucSaveCommandToCache()
   │
   ▼
③  三态取帧           ── 消费者：usTakeCommandFromCache()
   │  返回 0 = 取到完整帧
   ▼
④  解释执行           ── ucCommandInterpretation()
   │  switch(功能码)
   ▼
   具体处理函数（vSetVelocityCommand / vGetImuCommand / ...）
```

**为什么这么分层**：中断里只做"搬运"（最省时间），拆包和业务逻辑放主循环（可以慢慢做）。这是嵌入式通信的标准架构。

### 2.2 第一级：IDLE 中断 + DMA 收不定长帧

**初始化**（`mainloop.c`）：

```c
// UART1：主通讯
__HAL_UART_CLEAR_IDLEFLAG(&huart1);
__HAL_UART_ENABLE_IT(&huart1, UART_IT_IDLE);      // ★ 开 IDLE 中断
__HAL_UART_CLEAR_IDLEFLAG(&huart1);
ucUart1RecvEndCounter = 0;
ucUart1RxBufLen = 0;
HAL_UART_Receive_DMA(&huart1, pucUart1RxBuf, UART_RX_BUF_SIZE);   // DMA 常驻接收
```

**中断服务**（`stm32f3xx_it.c`）：

```c
void USART1_IRQHandler(void)
{
    uint32_t uiTemp = 0;
    uint16_t usTempLen = 0;
    if(__HAL_UART_GET_FLAG(&huart1, UART_FLAG_IDLE) != RESET){   // ★ 总线空闲
        HAL_UART_AbortReceive(&huart1);                          // 停当前 DMA
        __HAL_UART_CLEAR_IDLEFLAG(&huart1);
        uiTemp    = __HAL_DMA_GET_COUNTER(&hdma_usart1_rx);      // 还剩多少没搬
        usTempLen = UART_RX_BUF_SIZE - uiTemp;                   // 已收字节数
        if(UART_RX_BUF_SIZE >= ucUart1RxBufLen + usTempLen){
            memcpy(pucUart1RxBufCache + ucUart1RxBufLen, pucUart1RxBuf, usTempLen);
            ucUart1RxBufLen += usTempLen;                        // ★ 累加，处理拆包
        }
        HAL_DMA_Init(&hdma_usart1_rx);
        ucUart1RecvEndCounter++;                                 // 通知主循环
        HAL_UART_Receive_DMA(&huart1, pucUart1RxBuf, UART_RX_BUF_SIZE);
    }
    HAL_UART_IRQHandler(&huart1);
}
```

**三个技术点**：

1. **IDLE 中断 = 串口总线空闲**。STM32 的 USART 在接收完一个字节后，如果总线保持空闲超过一个字节时间，就置 IDLE 标志。这正好用来判断"**一帧数据到齐了**"——比用定时器超时判断精确得多。
2. **`__HAL_DMA_GET_COUNTER()` 反算长度**。DMA 配置的是"接收 N 个字节"，计数器从 N 递减，所以 `N - 剩余 = 已收`。
3. **`ucUart1RxBufLen += usTempLen` 累加**（不是赋值）。因为一次 IDLE 可能只收到**半帧**（上位机分两次 write，或者波特率高时中断来不及）。累加后由下游的取帧函数判断"够不够一帧"。

> 对比：USART2（IMU）用的是 `ucUart2RxBufLen = usTempLen` **覆盖**，注释写着 `//abandon old data`。
> 因为 IMU 是**周期性定长上报**，只要最新值，旧数据没意义。**同一个板子上两种策略**，这是很细致的设计。

### 2.3 第二级：环形缓冲（生产者）

`Communication.c` 里的环形缓冲结构：

```c
#define COMMAND_CACHE_SIZE 512

typedef struct {
    uint8_t pucCache[COMMAND_CACHE_SIZE];
    volatile uint16_t ucCacheSize;   // 总容量
    volatile uint16_t ucHead;        // 读指针（消费者动）
    volatile uint16_t ucTail;        // 写指针（生产者动）
    volatile uint16_t ucRemain;      // 剩余空间
} CommandCache_t;

static CommandCache_t xCommandCache;
```

**生产者**（主循环里调用，把中断收到的数据灌进环形缓冲）：

```c
uint8_t ucSaveCommandToCache(uint8_t ucCommandLen, uint8_t* pucCommandBuf)
{
    uint8_t pucTempBuf[ucCommandLen + 1];
    memcpy(pucTempBuf, pucCommandBuf, ucCommandLen + 1);
    if(ucCommandLen < xCommandCache.ucRemain){          // 空间够
        for(uint8_t i = 0; i < ucCommandLen; i++){
            xCommandCache.pucCache[xCommandCache.ucTail] = pucTempBuf[i];
            xCommandCache.ucTail   = (xCommandCache.ucTail + 1) % xCommandCache.ucCacheSize;
            xCommandCache.ucRemain -= 1;
            uiGetCacheCounter++;
        }
        return 0;
    }
    else{
        printf("Save Cache Faild ...");                  // 空间不够，丢弃
        return 1;
    }
}
```

**要点**：`ucRemain` 是**空间计数器**，避免用 `head == tail` 判断满/空（那种方法无法区分"空"和"满"）。这是环形缓冲的标准做法。

### 2.4 第三级：三态取帧（消费者）—— 拆包的核心

```c
// 返回: 0 = 取到完整帧  1 = 缓冲空  2 = 数据不够一帧  3 = 丢弃了非帧头字节
uint8_t usTakeCommandFromCache(void)
{
    uint8_t ucResult = 1;
    if(xCommandCache.ucHead == xCommandCache.ucTail){
        ucResult = 1;                                          // 缓冲空
    }
    else{
        if(xCommandCache.pucCache[xCommandCache.ucHead] == FRAME_HEAD){   // ① 是帧头
            uint16_t len = xCommandCache.pucCache[(xCommandCache.ucHead + 1) % xCommandCache.ucCacheSize];
            if(len <= (xCommandCache.ucCacheSize - xCommandCache.ucRemain)){  // ② 够一整帧
                ucCommandTempLen = len;
                for(uint8_t i = 0; i < ucCommandTempLen; i++){
                    pucCommandTempBuf[i] = xCommandCache.pucCache[xCommandCache.ucHead];
                    xCommandCache.ucHead = (xCommandCache.ucHead + 1) % xCommandCache.ucCacheSize;
                    xCommandCache.ucRemain += 1;
                    uiTakeCacheCounter++;
                }
                ucResult = 0;                                   // 取到完整帧
            }
            else{
                // 数据不够，先把能取的取出来等下一批
                ucCommandTempLen = (xCommandCache.ucCacheSize - xCommandCache.ucRemain);
                for(uint8_t i = 0; i < ucCommandTempLen; i++){ ... }
                ucResult = 2;
            }
        }
        else{
            // ③ 不是帧头 → 丢弃一个字节，继续找同步头
            xCommandCache.ucHead = (xCommandCache.ucHead + 1) % xCommandCache.ucCacheSize;
            xCommandCache.ucRemain += 1;
            ucResult = 3;
        }
    }
    return ucResult;
}
```

**这段代码就是"粘包/拆包"的完整答案**：

| 场景               | 处理                                |
| ---------------- | --------------------------------- |
| **粘包**（一次收到 3 帧） | 主循环用`while(result == 0)` 循环取，直到取空 |
| **拆包**（一帧分两次到）   | 读到帧长后发现缓冲里不够，返回 2，等下次数据到齐再取       |
| **垃圾数据**（噪声/误同步） | 头字节不是`0x5A`，丢弃一个字节继续找，返回 3        |

**为什么返回三态而不是布尔值**：调用方需要区分"没数据"（继续等）和"数据不全"（继续等）和"取到了"（处理）。用三态码可以让主循环写得很简洁。

### 2.5 第四级：解释执行

```c
int8_t ucCommandInterpretation(uint8_t ucCommandLen, uint8_t* pucCommandBuf)
{
    /* ---- 三重校验 ---- */
    if(pucCommandBuf[0] != FRAME_HEAD)  return -1;                       // ① 帧头
    if(pucCommandBuf[1] != ucCommandLen) return -1;                      // ② 帧长一致
    if(pucCommandBuf[ucCommandLen-1] != crc8_chk_value(pucCommandBuf, ucCommandLen-1)
       && (pucCommandBuf[ucCommandLen-1] != 0xff)) return -1;            // ③ CRC（0xFF 放行）

    /* ---- 设备 ID 过滤 ---- */
    if(pucCommandBuf[2] == ucDeviceID){
        switch (pucCommandBuf[3]){                                       // ④ 功能码分发
            case 0x01: vSetVelocityCommand(pucCommandBuf);    break;     // 速度控制
            case 0x03: vGetVelocityCommand();                 break;     // 查速度
            case 0x05: vGetImuCommand();                      break;     // 查 IMU
            case 0x07: vGetBatteryInfoCommand();              break;     // 查电池
            case 0x09: vGetOdmInfoCommand();                  break;     // 查里程计
            case 0x11: vGetOdmInfoCommand2();                 break;     // 查里程计(含vy)
            case 0x13: vGetRawImuCommand();                   break;     // 查 IMU 原始值
            case 0x15: vSetCarVelocityCommand(pucCommandBuf); break;     // 阿克曼速度控制
            case 0x19: vGetSonarCommand();                    break;     // 查超声波
            case 0x21: vGetBaseInfo(ucBaseType, ucMotorType, (float)fRatio, fWheelDiameter); break;
            case 0x23: vGetRawImuCommand2();                  break;     // 查 IMU 浮点值
            case 0x31: vSetMotorVelocityCommand(pucCommandBuf); break;   // 电机直控
            case 0x33: vGetMotorVelocityCommand();            break;     // 查电机转速
            case 0xf1: vGetVersion(pucHardwareVersion, pucSoftwareVersion); break;
            case 0xf3: vGetSN(puiUID);                        break;
            case 0xfd: vDoReboot();                           break;     // 软复位
            default: break;
        }
        return pucCommandBuf[ucCommandLen - 2];     // 返回预留位（0x00）
    }
    else{
        return -2;                                   // ID 不匹配
    }
}
```

**`0xFF` 跳过校验的玄机**：

```c
&& (pucCommandBuf[ucCommandLen-1] != 0xff)
```

README 里明确写了：**"CRC 校验：1Byte，校验方式为 CRC-8/MAXIM，设置为 0xFF，则强制不进行 CRC 校验"**。
所以 `0xFF` 是一个**故意的逃生门** —— 上位机调试时不想算 CRC，直接填 0xFF 就能通过。ROS 端的 0x19 超声波查询帧就用了这个技巧（硬编码 `chr(0xff)`）。

### 2.6 发送链路

**组帧**（以 0x04 上报速度为典型）：

```c
void vGetVelocityCommand(void)
{
    int16_t sLinex, sLiney, sAngleZ;
    sLinex  = (int16_t)(xVelocity.fLineX  * 1000.0f);    // 定点缩放
    sLiney  = (int16_t)(xVelocity.fLineY  * 1000.0f);
    sAngleZ = (int16_t)(xVelocity.fAngleZ * 1000.0f);

    ucCommandSendBuf[0]  = FRAME_HEAD;                                  // 0x5A
    ucCommandSendBuf[1]  = 12;                                          // 整帧长度
    ucCommandSendBuf[2]  = ucDeviceID;                                  // 0x01
    ucCommandSendBuf[3]  = 0x04;                                        // 功能码
    ucCommandSendBuf[4]  = (uint8_t)(sLinex  >> 8);                     // 大端：高字节先
    ucCommandSendBuf[5]  = (uint8_t)(sLinex);
    ucCommandSendBuf[6]  = (uint8_t)(sLiney  >> 8);
    ucCommandSendBuf[7]  = (uint8_t)(sLiney);
    ucCommandSendBuf[8]  = (uint8_t)(sAngleZ >> 8);
    ucCommandSendBuf[9]  = (uint8_t)(sAngleZ);
    ucCommandSendBuf[10] = 0x00;                                        // 预留位
    ucCommandSendBuf[11] = crc8_chk_value(ucCommandSendBuf, 11);        // CRC 覆盖前 11 字节
    vSendCommand(ucCommandSendBuf, ucCommandSendBuf[1]);                // 长度取自帧长字段
}
```

**注意大端写法**：`(uint8_t)(sLinex >> 8)` 先发高字节 —— 这是和教学例程（小端）最本质的区别。

**发送缓存**（`mainloop.c`，双通道）：

```c
void vSendCommand(uint8_t* pucSendBuf, uint8_t ucSendBufLen)
{
    if(bUSBUsed){                                        // USB CDC 通道
        if(usUSBSendLen + ucSendBufLen < 1024){
            memcpy(pucUSBSendBuf + usUSBSendLen, pucSendBuf, ucSendBufLen);
            usUSBSendLen += ucSendBufLen;
        }
    }
    if(bUartUsed){                                       // 串口通道
        if(usUart1TxCacheCounter + ucSendBufLen < UART_TX_BUF_SIZE){
            memcpy(pucUart1TxBufCache + usUart1TxCacheCounter, pucSendBuf, ucSendBufLen);
            usUart1TxCacheCounter += ucSendBufLen;
        }
    }
}
```

**实际发送**（主循环里，DMA + 忙标志）：

```c
void vUartLoopSend(void)
{
    if((usUart1TxCacheCounter > 0) && (ucUart1TxDMAOverFlag)){
        memcpy(pucUart1TxBuf, pucUart1TxBufCache, usUart1TxCacheCounter);
        if(HAL_OK != HAL_UART_Transmit_DMA(&huart1, pucUart1TxBuf, usUart1TxCacheCounter)){
            printf("DMA Faild %d \r\n", ...);
        }
        usUart1TxCacheCounter = 0;
        ucUart1TxDMAOverFlag = 0;                        // 置忙，防止覆盖
    }
}
```

发送完成标志在 DMA 中断里置回：

```c
void DMA1_Channel4_IRQHandler(void)          // USART1 TX
{
    if(__HAL_DMA_GET_FLAG(&hdma_usart1_tx, DMA_FLAG_TC4)){
        __HAL_DMA_CLEAR_FLAG(&hdma_usart1_tx, DMA_FLAG_TC4);
        HAL_UART_AbortTransmit(&huart1);
        ucUart1TxDMAOverFlag = 1;                // 解除忙状态
    }
    HAL_DMA_IRQHandler(&hdma_usart1_tx);
}
```

**双缓冲设计**：`pucUart1TxBufCache`（攒数据）→ `pucUart1TxBuf`（DMA 源）。
好处是**攒数据的时候不影响正在 DMA 发送的那份**。

### 2.7 CRC-8/MAXIM

```c
unsigned char crc8_chk_value(unsigned char *message, unsigned char len)
{
    uint8_t crc = 0;
    uint8_t i;
    while(len--){
        crc ^= *message++;
        for(i = 0; i < 8; i++){
            if(crc & 0x01)
                crc = (crc >> 1) ^ 0x8c;      // 反射多项式 0x8C
            else
                crc >>= 1;
        }
    }
    return crc;
}
```

**参数**：多项式 `x⁸+x⁵+x⁴+1`（0x131），反射写法 `0x8C`，初值 `0x00`，输入输出反射，无异或输出。
**校验范围**：帧头到预留位（即 `帧长 - 1` 字节）。

### 2.8 主循环里的调度

```c
while(1){
    /* --- 收：中断标记 → 灌进环形缓冲 --- */
    if(ucUart1RecvEndCounter != 0){
        ucUart1RecvEndCounter = 0;
        ucSaveCommandToCache(ucUart1RxBufLen, pucUart1RxBufCache);
        memset(pucUart1RxBufCache, 0, UART_RX_BUF_SIZE);
        ucUart1RxBufLen = 0;
        bUartUsed = true;
    }
    vUartLoopSend();
    vUSBLoopSend();

    /* --- 拆包 + 解释：一次排空所有已到帧 --- */
    ucTakeCacheResult = usTakeCommandFromCache();
    while(ucTakeCacheResult == 0){                 // ★ 循环取到取不出为止
        if(bUartConnectionFlag == false)
            bUartEstablishConnectionMark = true;   // 收到第一帧 → 标记"建立连接"
        uiLastRecvProtocolTick = HAL_GetTick();    // 刷新"最后一次收到协议数据"时间
        ucCommandInterpretation(ucCommandTempLen, pucCommandTempBuf);
        ucTakeCacheResult = usTakeCommandFromCache();
    }

    /* --- 100Hz 电机环 --- */
    if(HAL_GetTick() - uiMotorLastContorTick > MOTOR_CONTROL_PERIOD){   // 10ms
        vGetMotorSpeed(&xMotor1);
        vGetMotorSpeed(&xMotor2);
        vGetSpeed(&xVelocity);                                          // 正解 → 里程计
        vExecuteMotorSpeed(&xMotor1, fMotorPidCompute(&xMotor1));
        vExecuteMotorSpeed(&xMotor2, fMotorPidCompute(&xMotor2));
        uiMotorLastContorTick = HAL_GetTick();
    }

    /* --- 安全保护：800ms 无速度指令 → 停车 --- */
    if(HAL_GetTick() - uiLastVelCmdTick > VELOCITY_LAST_TIME && bPS2OperateFlag == false){
        vComputeMotorSpeed(0.0, 0.0, 0.0);
    }

    /* --- 断连判定：1000ms 无协议数据 → 报警 --- */
    if((HAL_GetTick() - uiLastRecvProtocolTick > DISCONNECT_WAIT_TIME) && bUartConnectionFlag){
        bUartLostConnectionMark = true;
    }
}
```

**三个时间常量的配合**：

| 常量                     | 值       | 作用            |
| ---------------------- | ------- | ------------- |
| `MOTOR_CONTROL_PERIOD` | 10 ms   | 电机环周期（100 Hz） |
| `VELOCITY_LAST_TIME`   | 800 ms  | 无速度指令 → 停车    |
| `DISCONNECT_WAIT_TIME` | 1000 ms | 无任何协议数据 → 判断连 |

**注意 800ms < 1000ms** 这个设计：**先停车，再报警**。因为停车是安全动作，必须比报警更早触发。

***

## 三、ROS 端实现

### 3.1 节点结构：5 个定时器

`base_control.py` 是一个**单文件 Python 节点**，靠 5 个 `rospy.Timer` 驱动：

| 定时器                    | 频率         | 周期     | 职责                                     |
| ---------------------- | ---------- | ------ | -------------------------------------- |
| `timerCommunicationCB` | **500 Hz** | 2 ms   | 收串口 → 环形队列 → 拆包 → 按功能码解析               |
| `timerOdomCB`          | 50 Hz      | 20 ms  | 发 0x09/0x11 查询 → 积分出位姿 → 发`/odom` + TF |
| `timerBatteryCB`       | 1 Hz       | 1 s    | 发 0x07 → 发`/battery`                   |
| `timerIMUCB`           | 50 Hz      | 20 ms  | 发 0x13 → 发`/imu`（默认关闭）                 |
| `timerSonarCB`         | 10 Hz      | 100 ms | 发 0x19 → 发`/sonar_1..4`（默认关闭）          |

```python
self.timer_odom          = rospy.Timer(rospy.Duration(1.0/self.odom_freq),        self.timerOdomCB)
self.timer_battery       = rospy.Timer(rospy.Duration(1.0/self.battery_freq),     self.timerBatteryCB)
self.timer_communication = rospy.Timer(rospy.Duration(1.0/500),                   self.timerCommunicationCB)
if(self.pub_imu):
    self.timer_imu       = rospy.Timer(rospy.Duration(1.0/self.imu_freq),         self.timerIMUCB)
```

### 3.2 发送：`/cmd_vel` → 0x01 帧

```python
def cmdCB(self, data):
    self.trans_x = data.linear.x
    self.trans_y = data.linear.y
    self.rotat_z = data.angular.z
    self.last_cmd_vel_time = rospy.Time.now()

    # 组帧
    output = chr(0x5a) + chr(12) + chr(0x01) + chr(0x01) + \
        chr((int(self.trans_x*1000.0)>>8)&0xff) + chr(int(self.trans_x*1000.0)&0xff) + \
        chr((int(self.trans_y*1000.0)>>8)&0xff) + chr(int(self.trans_y*1000.0)&0xff) + \
        chr((int(self.rotat_z*1000.0)>>8)&0xff) + chr(int(self.rotat_z*1000.0)&0xff) + \
        chr(0x00)

    # 用整数列表重算一遍 CRC
    outputdata = [0x5a,0x0c,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00]
    outputdata[4] = (int(self.trans_x*1000.0)>>8)&0xff
    outputdata[5] =  int(self.trans_x*1000.0)&0xff
    outputdata[6] = (int(self.trans_y*1000.0)>>8)&0xff
    outputdata[7] =  int(self.trans_y*1000.0)&0xff
    outputdata[8] = (int(self.rotat_z*1000.0)>>8)&0xff
    outputdata[9] =  int(self.rotat_z*1000.0)&0xff
    crc_8 = self.crc_byte(outputdata, len(outputdata)-1)
    output += chr(crc_8)

    # 互斥 + 发送
    while self.serialIDLE_flag:
        time.sleep(0.01)
    self.serialIDLE_flag = 4
    try:
        while self.serial.out_waiting:
            pass
        self.serial.write(output)
    except:
        rospy.logerr("Vel Command Send Faild")
    self.serialIDLE_flag = 0
```

**几个观察**：

1. **同样的帧被构造了两次** —— 一次用 `chr()` 拼字符串（给 `write` 用），一次用 `int` 列表（给 CRC 用）。这是冗余写法，本可以用同一份数据。
2. **`serialIDLE_flag` 是个软件互斥锁** —— 因为 5 个定时器回调可能并发（rospy.Timer 默认多线程），都用同一个串口。用"自旋 + sleep(0.01)"实现，**不是线程安全的原子操作**，但实践中够用。
3. **`>>8` 先发高字节 = 大端**，和固件端一致。

### 3.3 接收：500 Hz 轮询 + 环形队列 + 拆包

**第一步：把串口数据灌进 Python 环形队列**

```python
def timerCommunicationCB(self, event):
    length = self.serial.in_waiting
    if length:
        reading = self.serial.read_all()
        if len(reading) != 0:
            for i in range(0, len(reading)):
                data = (int(reading[i].encode('hex'), 16))     # Python 2：字节 → int
                try:
                    self.Circleloop.enqueue(data)
                except:
                    pass                                        # 队列满就丢弃
```

环形队列是手写的类：

```python
class queue:
    def __init__(self, capacity = 1024*4):
        self.capacity = capacity
        self.size = 0
        self.front = 0
        self.rear = 0
        self.array = [0]*capacity

    def enqueue(self, element):
        if self.is_full(): raise Exception('queue is full')
        self.array[self.rear] = element
        self.size += 1
        self.rear = (self.rear + 1) % self.capacity

    def dequeue(self):
        if self.is_empty(): raise Exception('queue is empty')
        self.size -= 1
        self.front = (self.front + 1) % self.capacity

    def get_front(self):        return self.array[self.front]
    def get_front_second(self): return self.array[((self.front + 1) % self.capacity)]
    def get_queue_length(self): return (self.rear - self.front + self.capacity) % self.capacity
```

**第二步：拆包 —— 和固件端几乎一样的逻辑**

```python
    if self.Circleloop.is_empty() == False:
        data = self.Circleloop.get_front()
        if data == 0x5a:                                          # ① 帧头
            length = self.Circleloop.get_front_second()           # ② 帧长
            if length > 1:
                if self.Circleloop.get_front_second() <= self.Circleloop.get_queue_length():
                    databuf = []
                    for i in range(length):                       # ③ 取走整帧
                        databuf.append(self.Circleloop.get_front())
                        self.Circleloop.dequeue()

                    if (databuf[length-1]) == self.crc_byte(databuf, length-1):
                        pass                                      # ④ CRC 校验（不过只 pass）
                    else:
                        pass                                      # ★ 校验失败也没处理！

                    # ⑤ 按功能码解析
                    if(databuf[3] == 0x04):
                        self.Vx    = databuf[4]*256 + databuf[5]
                        self.Vy    = databuf[6]*256 + databuf[7]
                        self.Vyaw  = databuf[8]*256 + databuf[9]
                    elif(databuf[3] == 0x06):
                        self.Yawz  = databuf[8]*256 + databuf[9]
                    elif (databuf[3] == 0x08):
                        self.Vvoltage = databuf[4]*256 + databuf[5]
                        self.Icurrent = databuf[6]*256 + databuf[7]
                    elif (databuf[3] == 0x0a):
                        self.Vx    = databuf[4]*256 + databuf[5]
                        self.Yawz  = databuf[6]*256 + databuf[7]
                        self.Vyaw  = databuf[8]*256 + databuf[9]
                    elif (databuf[3] == 0x12):
                        self.Vx    = databuf[4]*256 + databuf[5]
                        self.Vy    = databuf[6]*256 + databuf[7]
                        self.Yawz  = databuf[8]*256 + databuf[9]
                        self.Vyaw  = databuf[10]*256 + databuf[11]
                    elif (databuf[3] == 0x14):
                        # 32 字节原始 IMU：Gyro/Accel(int32) + Quat(int16)
                        self.Gyro[0] = int(((databuf[4]&0xff)<<24)|((databuf[5]&0xff)<<16)|((databuf[6]&0xff)<<8)|(databuf[7]&0xff))
                        ...
                    elif (databuf[3] == 0x1a):
                        self.Sonar[0..3] = databuf[4..7]
                    elif(databuf[3] == 0xf2):
                        # 硬件/固件版本
                    elif(databuf[3] == 0xf4):
                        # SN
                    elif(databuf[3] == 0x22):
                        # 底盘信息（车型/电机/减速比/轮径）
        else:
            self.Circleloop.dequeue()                              # 非帧头 → 丢弃一格
```

**⚠️ 这里有个明显问题**：CRC 校验写了，但**无论成功失败都是 `pass`** —— 也就是说**CRC 完全没起作用**。固件端有严格校验，但 ROS 端等于没校验。

**⚠️ 另一个问题**：解析时用的是 `databuf[4]*256 + databuf[5]` 拼出**无符号**值，后面才在 `timerOdomCB` 里用 `ctypes.c_int16()` 转成有符号。这是"先拼后转"的写法，逻辑上正确但绕。

### 3.4 里程计计算

```python
def timerOdomCB(self, event):
    # ① 按固件版本选查询指令
    if self.movebase_firmware_version[1] == 0:
        output = chr(0x5a) + chr(0x06) + chr(0x01) + chr(0x09) + chr(0x00) + chr(0x38)   # 旧固件
    else:
        output = chr(0x5a) + chr(0x06) + chr(0x01) + chr(0x11) + chr(0x00) + chr(0xa2)   # 新固件

    # ② 发送查询（同样走 serialIDLE_flag 互斥）
    while(self.serialIDLE_flag): time.sleep(0.01)
    self.serialIDLE_flag = 1
    try:
        while self.serial.out_waiting: pass
        self.serial.write(output)
    except:
        rospy.logerr("Odom Command Send Faild")
    self.serialIDLE_flag = 0

    # ③ 解析（收到的是上一轮查询的结果）
    Vx   = float(ctypes.c_int16(self.Vx).value   / 1000.0)     # 无符号 → 有符号 → 缩放
    Vy   = float(ctypes.c_int16(self.Vy).value   / 1000.0)
    Vyaw = float(ctypes.c_int16(self.Vyaw).value / 1000.0)

    self.pose_yaw = float(ctypes.c_int16(self.Yawz).value / 100.0)   # ★ 航向直接来自 IMU
    self.pose_yaw = self.pose_yaw * math.pi / 180.0                  # 度 → 弧度

    # ④ 积分
    self.current_time = rospy.Time.now()
    dt = (self.current_time - self.previous_time).to_sec()
    self.previous_time = self.current_time
    self.pose_x += Vx * math.cos(self.pose_yaw) * dt - Vy * math.sin(self.pose_yaw) * dt
    self.pose_y += Vx * math.sin(self.pose_yaw) * dt + Vy * math.cos(self.pose_yaw) * dt

    # ⑤ 发布 /odom + TF
    pose_quat = tf.transformations.quaternion_from_euler(0, 0, self.pose_yaw)
    msg = Odometry()
    msg.header.stamp     = self.current_time
    msg.header.frame_id  = self.odomId            # 'odom'
    msg.child_frame_id   = self.baseId            # 'base_footprint'
    msg.pose.pose.position.x = self.pose_x
    msg.pose.pose.position.y = self.pose_y
    msg.pose.pose.orientation.z = pose_quat[2]
    msg.pose.pose.orientation.w = pose_quat[3]
    msg.twist.twist.linear.x  = Vx
    msg.twist.twist.linear.y  = Vy
    msg.twist.twist.angular.z = Vyaw
    self.pub.publish(msg)

    self.tf_broadcaster.sendTransform((self.pose_x, self.pose_y, 0.0), pose_quat,
                                      self.current_time, self.baseId, self.odomId)
```

**★ 关键点：航向角来自 IMU，不是来自左右轮速差**

0x0A / 0x12 帧里的 `Yaw` 字段是**固件从 IMU 拿到的偏航角**（`xImu.pfEuler[2]`），ROS 端直接拿它当航向，只对 x/y 做积分。

这和"标准轮式里程计"不同：

* **标准做法**：`θ += ω·dt`，ω 由 `(v_R − v_L)/轮距` 得到
* **这里做法**：`θ = IMU 直接给的角度`，轮速只贡献线速度

**取舍**：打滑时航向更稳（IMU 不受轮子打滑影响），但 **IMU 零漂会直接进 odom**，长时间运行会累积偏航误差。

### 3.5 Python 版 CRC 实现

```python
def crc_1byte(self, data):
    crc_1byte = 0
    for i in range(0, 8):
        if ((crc_1byte ^ data) & 0x01):
            crc_1byte ^= 0x18
            crc_1byte >>= 1
            crc_1byte |= 0x80
        else:
            crc_1byte >>= 1
        data >>= 1
    return crc_1byte

def crc_byte(self, data, length):
    ret = 0
    for i in range(length):
        ret = self.crc_1byte(ret ^ data[i])
    return ret
```

**这段写法和固件端完全不同，但结果等价**。已实测验证：

| 测试帧                                | 协议文档给的 CRC |  固件 C 算的 | Python 算的 |
| ---------------------------------- | :--------: | :------: | :-------: |
| `5A 0C 01 01 01 F4 00 00 00 00 00` |   `0x56`   | `0x56` ✓ |  `0x56` ✓ |
| 0xF1 版本查询                          |   `0xD7`   |     ✓    |     ✓     |
| 0x09 里程计查询                         |   `0x38`   |     ✓    |     ✓     |
| 0x11 里程计查询                         |   `0xA2`   |     ✓    |     ✓     |
| 0x07 电池查询                          |   `0xE4`   |     ✓    |     ✓     |
| 0x13 IMU 查询                        |   `0x33`   |     ✓    |     ✓     |

**等价性证明**（`crc_1byte` 里那个 `c ^= 0x18; c >>= 1; c |= 0x80` 其实等于 `c = (c>>1) ^ 0x8C`）：

因为 `0x18 >> 1 = 0x0C`，而 `0x8C = 0x0C | 0x80`，且 `c>>1` 的第 7 位必为 0，
所以 `((c^0x18)>>1) | 0x80 = ((c>>1)^0x0C) | 0x80 = (c>>1)^0x0C^0x80 = (c>>1)^0x8C`。

只是 Python 版把 `data` 也一起移位（逐位喂入），而 C 版是一次性 `crc ^= byte` 再跑 8 轮。两种都是 CRC 的标准实现形式。

### 3.6 启动握手

```python
def __init__(self):
    ...
    self.getVersion()          # 发 0xF1 查版本
    time.sleep(2.2)            # ★ 等 IMU 初始化完成
    self.getSN()               # 发 0xF3 查 SN
    time.sleep(0.01)
    self.getInfo()             # 发 0x21 查底盘信息
```

**为什么 `sleep(2.2)`**：固件的注释写着

> 上位机-底盘建立连接定义：在为建立连接的状态下，底盘收到协议内数据，则判定为建立连接，**建立连接时，底盘 IMU 会执行初始化，耗时 2S 左右**，所以建议以不低于 2hz 的频率向底盘发送指令

也就是说，**上位机发第一个包的时候，底盘会花 2 秒初始化 IMU，期间底盘阻塞**。所以 ROS 端必须等这 2 秒过去，才能继续查 SN / 底盘信息。

而且这条约定还解释了：**为什么 odom 查询要 50Hz** —— 远高于 2Hz 的最低要求，保证连接不会因为偶尔丢包而断开。

***

## 四、一次完整往返（时序）

```
时刻      ROS 端（Python）                          STM32 端（C 固件）
────────────────────────────────────────────────────────────────────────────
 t0   /cmd_vel 到达 → cmdCB()
 t0+  int(x*1000)>>8 组帧，算 CRC
      加锁 serialIDLE_flag = 4
      serial.write(11 字节)
                                                ──▶  DMA 搬运到 pucUart1RxBuf
 t1                                              总线空闲 → IDLE 中断
                                                memcpy → pucUart1RxBufCache
                                                ucUart1RecvEndCounter++
 t2   （500Hz 定时器空转，队列空）              ◀──  主循环：ucSaveCommandToCache()
                                                    灌进环形缓冲
 t3                                                  usTakeCommandFromCache() → 0
                                                    ucCommandInterpretation()
                                                    三重校验通过
                                                    case 0x01 → vSetVelocityCommand()
                                                    vComputeMotorSpeed(vx, vy, ωz)
                                                    → xMotor1/2.sTargetRpm
 t4                                                  （下一个 10ms 边界）
                                                    fMotorPidCompute() → PWM
                                                    ★ 轮子开始转

 ...                                                
 t5   50Hz 定时器 → timerOdomCB()
      发 0x11 查询帧                            ──▶  解释 0x11 → vGetOdmInfoCommand2()
 t6                                              组 0x12 帧（14 字节）
                                                    vSendCommand() → 发送缓存
                                                    vUartLoopSend() → DMA
      ◀──  环形队列 enqueue 14 字节
 t7   timerCommunicationCB 拆包
      databuf[3]==0x12 → 解析 Vx/Vy/Yaw/ωz
      积分 → pose_x/pose_y
      发布 /odom + TF(odom → base_footprint)
```

**注意 t5 的"延迟一拍"**：`timerOdomCB` 是**先发查询、再解析**，解析的是**上一轮查询的结果**（存在 `self.Vx` 等成员变量里）。所以 `/odom` 的实际数据延迟约 20ms（一个查询周期）。

***

## 五、两端对照总结

| 维度        | STM32 端                  | ROS 端                               |
| --------- | ------------------------ | ----------------------------------- |
| 语言 / 运行环境 | C（Keil MDK）              | Python 2（ROS Melodic/Kinetic）       |
| 接收驱动      | **DMA + IDLE 中断**（事件驱动）  | **500Hz 定时器轮询** `in_waiting`        |
| 缓冲        | 512 B 环形缓冲 + 空间计数器       | 4096 元素环形队列（手写类）                    |
| 拆包        | 帧头 +**帧长预判**，三态返回        | 帧头 + 帧长预判，类似逻辑                      |
| 帧长不足      | 返回 2 等待                  | 直接跳过（不取）                            |
| CRC       | **严格校验**（0xFF 放行）        | **算了但 `pass`，等于没校验** ⚠️             |
| 发送        | 双缓冲 + DMA，完成中断置标志        | `serial.write()` + `out_waiting` 自旋 |
| 并发保护      | 环形缓冲 head/tail/remain 分离 | `serialIDLE_flag` 软件互斥（自旋）          |
| 字节序       | 大端（`>>8` 先发）             | 大端（`>>8` 先发）✓ 一致                    |
| 定点缩放      | 1000 打包                  | ÷1000 解包 ✓ 一致                       |

### 三个值得注意的实现差异

**① 接收机制完全不同**
STM32 是**事件驱动**（中断触发），ROS 是**轮询**（500Hz 定时器）。
Python 里没法像 C 那样挂中断，500Hz 轮询已经足够（串口 115200，一帧 11 字节约 1ms 传完）。

**② 固件端的"断连保护"靠上位机的查询频率**
上位机 odom 查询 50Hz，远高于固件要求的 2Hz。如果上位机挂了不发数据，固件 800ms 后自动停车、1000ms 后判断连报警。

**③ ROS 端的 CRC 形同虚设**

```python
if (databuf[length-1]) == self.crc_byte(databuf, length-1):
    pass
else:
    pass          # ← 校验失败什么都不做
```

这是这份代码里**最明显的缺陷**。固件端做了严格校验（还留了 0xFF 逃生门），上位机却把结果丢掉了。如果要改进，这里应该：校验失败 → 丢弃该帧 + 计数 + 报警。

***

## 六、面试问答

**Q：你们的串口协议是怎么设计的？**

> 帧头 `0x5A` + 帧长 + 设备 ID + 功能码 + 数据 + 预留位 + CRC-8/MAXIM。
> 三条约定：**功能码奇偶分方向**（下行奇数、上行偶数，抓包一眼判方向）；**帧长自带**（拆包不依赖结束符，数据里可以是任意字节）；**留了 ID 和预留位**（为级联和协议升级）。
> 物理量全部 ×1000 定点化，避免在 MCU 上跑浮点通信。

**Q：粘包/拆包怎么处理的？**

> 分四级：中断用 **DMA + IDLE** 判定一帧收完；灌进 **512 字节环形缓冲**；取帧函数先验帧头 `0x5A`，再读帧长判断缓冲里够不够一整帧 —— **够就取走，不够就等，不是帧头就丢一格继续找同步**；最后三重校验（帧头、帧长一致、CRC）才进业务分发。
> 取帧函数返回三态码（0=取到 / 1=空 / 2=不够 / 3=丢弃垃圾），主循环用 `while(result==0)` 一次排空所有已到帧。

**Q：怎么保证通信可靠性？**

> 三层：**帧头同步**、**帧长一致性校验**、**CRC-8/MAXIM**。
> 另外还有两个安全机制：**800ms 无速度指令自动停车**（防止上位机卡死时车跑飞），**1000ms 无协议数据判断连并报警**。注意 800 < 1000，**先停车再报警**。

**Q：你的里程计怎么算的？**

> 固件端做**正运动学**：`v = (n_L + n_R)/2 · πD / 60`，得到线速度；**航向角直接取 IMU 的偏航角**，不是用轮速差算的。
> ROS 端做**积分**：`x += vx·cosθ·dt − vy·sinθ·dt`，50Hz 发布 `/odom` 和 TF。
> 这样做的好处是打滑时航向更稳，代价是 IMU 零漂会累积进 odom。

**Q：这段代码有什么可以改进的？**

> 三点：
>
> 1. **ROS 端 CRC 校验算了但没处理** —— `if...pass else...pass`，等于没校验，应该改成校验失败就丢帧并计数。
> 2. **`serialIDLE_flag` 不是原子操作** —— 5 个定时器回调并发访问同一个串口，用"自旋 + sleep(0.01)"做互斥，理论上存在竞态窗口，应该用 `threading.Lock`。
> 3. **cmdCB 里同一帧构造了两遍**（一遍 `chr()` 字符串、一遍 `int` 列表），可以合并成一份数据再转。

***

## 七、一页速查

```
帧格式   5A | 帧长(整帧) | ID(0x01) | 功能码 | 数据 | 预留(0x00) | CRC-8
CRC      CRC-8/MAXIM，多项式反射 0x8C，初值 0，覆盖"帧头→预留位"
         CRC 位置填 0xFF = 强制跳过校验
字节序   大端（MSB 先发）
物理量   ×1000（速度）/ ×100（角度）/ ×100000（IMU 原始）/ ×10000（四元数）
下行     /cmd_vel → 0x01 帧（12 B）→ 逆运动学 → PID → PWM
上行     /odom    ← 0x0A / 0x12 帧  ← 正运动学 + IMU 偏航角
         /battery ← 0x08 帧
         /imu     ← 0x14 帧
关键周期 电机环 10ms · odom 查询 50Hz · 串口收 500Hz · 电池 1Hz
安全     800ms 无速度指令停车 · 1000ms 无数据判断连
```

```
调度模型    裸机 while(1) 协作式轮询 + 中断注入，19 个 if 块
            无优先级、非抢占、周期 = 设定值 + 循环耗时
轮询周期    电机环 10ms(100Hz) · 电池电流 5ms · 指示灯 10ms
            PS2 20ms · 超声波 50ms · 电池电压 100ms
事件中断    USART1 IDLE 收帧 · USART2 IDLE(IMU) · TIM6(舵机)
            DMA1_CH4 发送完成 · EXTI15_10 超声波回波 · CAN · USB
超时保护    800ms  无速度指令 → 主动停车（安全动作）
            1000ms 无协议数据 → 判断连 + 报警（通知动作）
            PS2 有操作时绕过速度超时（双控制源仲裁）
顺序要点    收包(第6步) → 拆包(第8步) → 电机环(第10步)
            让"刚收到的指令"当轮生效，延迟从 2 周期降到 1 周期
负载        CPU ≈ 2% · 串口 ≈ 10.4%（1.2 KB/s ÷ 11.5 KB/s）
ROS 侧配合   通信 500Hz · odom 查询 50Hz · 电池 1Hz
            500Hz 轮询 >> 帧传输 1.2ms，确保不丢
```

# 里程计

![1.00](/images/%E9%A1%B9%E7%9B%AE%E7%BB%8F%E5%8E%86/%E6%88%91%E7%9A%84%E9%A1%B9%E7%9B%AE/2026-10-13T07-24-56-367Z-09d73d36-image.png)