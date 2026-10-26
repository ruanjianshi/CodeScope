---
contents:
  - id: 46
    label: singleresume
    language: latex
  - id: 45
    label: main.tex
    language: latex
  - id: 159
    label: singleresume.bak
    language: latex
  - id: 171
    label: resume-mech
    language: latex
createdAt: 1788511095111
description: "LaTeX 工程：latex"
folderId: 25
id: 38
isDeleted: 0
isFavorites: 0
name: main
updatedAt: 1788511095111
tags:
  - 28
---

## Fragment: singleresume
```latex
\documentclass[10pt]{article}

\usepackage[a4paper,left=1.15cm,right=1.15cm,top=0.65cm,bottom=0.55cm]{geometry}
\usepackage{xcolor}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{fontspec}
\usepackage{xeCJK}
\usepackage{fontawesome5}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{tabularx}
\usepackage{array}
\usepackage{titlesec}

\setmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold
]{NotoSerifSC}
\setCJKmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold
]{NotoSerifSC}

\definecolor{primary}{HTML}{173E35}
\definecolor{accent}{HTML}{B68B38}
\definecolor{ink}{HTML}{18212A}
\definecolor{muted}{HTML}{64717D}
\definecolor{soft}{HTML}{EDF3F0}
\definecolor{line}{HTML}{D5DFDB}

\hypersetup{
    colorlinks=true,
    urlcolor=accent,
    linkcolor=primary
}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\linespread{0.940}
\emergencystretch=3em
\tolerance=1800
\setlist[itemize]{
    leftmargin=1.35em,
    itemsep=0.05em,
    topsep=0.08em,
    parsep=0pt,
    partopsep=0pt,
    label=\textcolor{accent}{\scriptsize\faCircle}
}

\newcommand{\mainsection}[2]{%
    \vspace{0.30em}
    \noindent\hbox to \linewidth{{\large\bfseries\color{primary}%
    \makebox[1.45em][c]{#1}\hspace{0.35em}#2}\hspace{0.55em}%
    {\color{accent}\leaders\hrule height 0.9pt\hfill\kern0pt}}\par
    \vspace{0.12em}
}
\newcommand{\entryhead}[3]{%
    \begin{tabularx}{\linewidth}{@{}>{\raggedright\arraybackslash}p{7.2cm}>{\centering\arraybackslash}X>{\raggedleft\arraybackslash}p{3.2cm}@{}}
    {\normalsize\bfseries\color{ink}#1} &
    {\footnotesize\bfseries\color{primary}#2} &
    {\footnotesize\bfseries\color{muted}#3}
    \end{tabularx}\vspace{0.03em}
}
\newcommand{\tech}[1]{%
    {\footnotesize\color{muted}\textbf{技术栈}\enspace #1}\par\vspace{0.03em}
}
\newcommand{\skillrow}[2]{%
    \textbf{\color{primary}#1} & #2\\[0.10em]
}
\newcommand{\awarditem}[1]{%
    \makebox[1.05em][l]{\color{accent}\scriptsize\faTrophy}%
    {\footnotesize #1}\par\vspace{0.02em}
}

\begin{document}

% ── 顶部身份信息 ──
\noindent
\begin{minipage}[c]{0.80\linewidth}
    {\fontsize{25}{28}\selectfont\bfseries\color{ink}肖琦}\par
    \vspace{0.16em}
    {\footnotesize\color{muted}
    \faPhone\enspace 15347348975 \quad
    \faEnvelope\enspace\href{mailto:2408128687@qq.com}{2408128687@qq.com} \quad
    \faWeixin\enspace xiao15096010804\par
    \faMapMarker*\enspace 湖南省衡阳 \quad
    \faFlag\enspace 中共党员 \quad
    \faBriefcase\enspace 深圳 / 长沙}
\end{minipage}%
\begin{minipage}[c]{0.19\linewidth}
    \raggedleft
    \begin{tikzpicture}
        \clip (0,0) circle (1.00cm);
        \node at (0,-0.01) {\includegraphics[width=2.10cm]{figures/amater.jpg}};
        \draw[accent,line width=1.1pt] (0,0) circle (1.00cm);
    \end{tikzpicture}
\end{minipage}

\vspace{0.08em}
{\color{primary}\rule{\linewidth}{1.5pt}}

% ── 个人情况 ──
\mainsection{\faUser}{个人情况}
{\footnotesize
\begin{tabularx}{\linewidth}{@{}p{3.7cm}p{5.8cm}X@{}}
\textbf{出生年月}：2002.11 &
\textbf{求职意向}：嵌入式 Linux 开发 &
\textbf{技术方向}：Linux 底层、机器人控制、工业通信
\end{tabularx}}
\vspace{0.15em}
\noindent\makebox[2.65cm][l]{\bfseries\color{primary}武汉科技大学}{\scriptsize\color{accent}（省部共建 · 省属重点）}\hspace{0.5em}%
机械专业硕士（专硕）· 机械工程学院\hfill{\color{muted}2024.09 -- 2027.06}\par
\hspace*{2.65cm}{\footnotesize \textbf{研究方向}：轮腿机器人运动控制、强化学习；初试 363（前十），综合 5/172，均分 83.5}\par
\vspace{0.10em}
\noindent\makebox[2.65cm][l]{\bfseries\color{primary}湖南工学院}{\scriptsize\color{accent}（省属公办本科）}\hspace{0.5em}%
机械设计制造及其自动化\hfill{\color{muted}2020.09 -- 2024.06}\par
\hspace*{2.65cm}{\footnotesize \textbf{主修}：自动控制原理、现代控制原理、模电 / 数电、单片机原理与应用；班级 1/43，专业 3/164}\par
\vspace{0.14em}
\colorbox{soft}{\parbox{\dimexpr\linewidth-2\fboxsep\relax}{\footnotesize\color{ink}
\textbf{岗位优势}\enspace 嵌入式 Linux / 机器人底层方向：能把一条控制链路从 MCU 做到应用层——驱动接口、协议解析、中间件封装、系统联调、故障定位；现场问题习惯用日志、抓包与 GDB 收敛。}}

% ── 实习经历 ──
\mainsection{\faBriefcase}{实习经历}
\entryhead{武汉格蓝若智能技术股份有限公司}
  {嵌入式 Linux 实习生 · 人形/四足机器人底层控制}
  {2025.11 -- 2026.06}
\tech{RK3588、Linux、C++、CMake、ROS2、PCIe-to-CAN、CANopen、GDB、STM32F4、EtherCAT、SIG5632、远程控制、Bootloader}
\begin{itemize}
    \item Linux 关节驱动：在 RK3588 上用 C++/CMake 搭起 6 路 CAN 多线程并发控制（初始化 / 发送队列 / 接收解析 / 状态监测），封装为 ROS2 话题/服务；自下而上打通 PCIe 转 CAN → CANopen SDO → 电机私有协议三层，位置 / 速度 / 力矩 / MIT / 回零五种模式全部跑通，\textbf{满载回环测试通过}。
    \item 链路级问题定位：用 CAN 分析仪与带通信解码的示波器，按 CAN 报文 → PCIe 时序 → 电源电流 → 信号线压差逐段排查，\textbf{定位丢帧与上电异常根因并输出硬件整改建议}。
    \item 六维力传感器：STM32F4（CubeMX + HAL + FreeRTOS）+ SIG5632/5634，以 SPI 与外部中断完成 6 路同步采样；信号链「模拟输入 → PGA 可编程增益 → $\Sigma$-$\Delta$ 调制 → 数字滤波 → 32 位输出」，力矩阵解算后经 AX58100 以 EtherCAT PDO 周期上报，\textbf{采样—解算—上报全链路闭环}。
    \item 仓储底盘与末端：适配 200 kg 级升降立柱 RS485 协议，开发电推杆夹取与气泵吸盘控制（MOS 管 + 栅极驱动）；完成底盘报文解析、ROS 发布订阅接口、动作时序与限位保护，\textbf{底盘 / 升降 / 夹取 / 吸取四类动作联调通过}。
    \item 电源管理（BMS）：双电池冗余 + 过压欠压 + 制动能量泄放 + 刹车电路；经 3 路 RS485、2 路 CAN 与 USART 监测电量 / 温度 / 电流，实现硬件急停 / RF 遥控 / 上位软件指令三级仲裁，\textbf{8 条状态迁移路径全部可恢复}（初始化→安全→就绪→上电→急停→故障→复位）。
\end{itemize}

% ── 项目经历 ──
\mainsection{\faProjectDiagram}{项目经历}
\entryhead{四连杆两轮腿机器人（轮 + 足）}
  {独立开发 · 嵌入式 Linux / 驱动 / 通信 / 部署}
  {2026.01 -- 2026.09}
\tech{Jetson Nano、Linux、ROS1、EtherCAT、CAN FD、C++、R86 / R52、MuJoCo}
\begin{itemize}
    \item Linux 控制与通信：Jetson Nano 上搭建 ROS1 控制框架，编写 R86/R52 电机 MIT 驱动、IMU 接口与通信节点；打通 100 M EtherCAT 转 4 路 CAN FD（5 Mbps，每通道串 8 路电机），\textbf{链路周期稳定，8 路串联电机同步可控}。
    \item 四层自制硬件：自下而上为 Jetson Nano 拓展板（DC-DC、SPI 转 RS485/CAN）、DCU 电机总驱、安全 BMS 电源板与急停回路，\textbf{四层板卡联调通过，供电 / 通信 / 保护链路打通}。
    \item 部署联调：集成 7 寸屏、雷达与 RGB-D 相机；PPO 策略经 MuJoCo sim2sim 验证后迁到实机（42 维观测 → 8 维动作），\textbf{策略在实机上闭环运行}，并完成电机 ID / 零点校准与 PD 调优。
\end{itemize}

\entryhead{ROS 差分驱动小车底层控制与自主导航}
  {嵌入式开发 · STM32 底层 / 串口协议 / Linux ROS 驱动}
  {2025.09 -- 2025.12}
\tech{STM32F303、HAL、PID、编码器、USART / CRC-8、Ubuntu、C++、多线程、CMake、GDB、ROS、Cartographer、AMCL}
\begin{itemize}
    \item 自制底层控制板：独立完成 STM32F303 控制板原理图与 PCB，集成最小系统、电机驱动、编码器、USART 与电源保护；从选型、焊接、上电检查到分模块测试，\textbf{排查并解决供电 / 信号 / 通信问题，整车控制链路跑通}。
    \item STM32 底层控制：以 PWM、外部中断与定时器驱动 25GA370 并实现编码器测速，完成增量式 PID 速度环、差速逆运动学与里程计解算，\textbf{速度环跟踪稳定，起步抖动与过冲明显改善}。
    \item 协议与 Linux 驱动：设计「帧头+帧长+ID+功能码+数据+CRC-8」协议，处理粘包 / 拆包与收发校验；Ubuntu 下编写多线程串口节点封装 cmd\_vel、odom、imu 话题，115200 波特率下毫秒级交互，\textbf{用 GDB 定位并修复丢帧与数据竞争}。
    \item 建图与导航验证：接入激光雷达，完成 base\_footprint → odom → map 坐标变换标定；Cartographer 建图 + AMCL 定位 + move\_base 规划，\textbf{多点自主导航与动态避障跑通}，反向验证底层控制与串口链路的实时性。
\end{itemize}

\entryhead{STM32 / OpenMV 智能物流小车}
  {主控代码撰写 · 运动控制 / 视觉识别}
  {2025.08 -- 2025.09}
\tech{STM32F407、FreeRTOS、麦克纳姆轮、520 编码电机、42 步进电机、OpenMV4 H7 Plus、UART、超声波}
\begin{itemize}
    \item 底层与运动控制：STM32F407 + FreeRTOS 驱动 4 路 520 编码电机、42 步进滑轨、舵机与超声波，实现麦克纳姆轮运动学；以任务、队列与状态机协调底盘 / 升降 / 云台 / 夹爪，\textbf{自动取放流程跑通}。
    \item 视觉与通信：OpenMV4 上实现红 / 蓝 / 绿 / 灰 / 黄五色与多种几何形状识别，设计 UART 双向协议与 STM32 交换目标信息，\textbf{物料定位与自动分拣完成}。
\end{itemize}

% ── 专业技能 ──
\mainsection{\faTools}{专业技能}
{\footnotesize
\begin{tabularx}{\linewidth}{@{}p{2.75cm}X@{}}
\skillrow{C/C++ 与 Linux}{STL、面向对象与模块化设计；文件 I/O、进程 / 线程、同步互斥、Socket；CMake / Makefile、交叉编译、Git、GDB}
\skillrow{总线与协议}{UART、SPI、I\textsuperscript{2}C、RS485/232、CAN / CAN FD、CANopen、EtherCAT、LIN、UDS}
\skillrow{MCU 与实时系统}{STM32 固件库 / HAL、FreeRTOS / RT-Thread；中断、DMA、Bootloader、状态机与实时任务}
\skillrow{机器人与控制}{ROS1 / ROS2 话题服务、URDF / TF、里程计；FOC / SVPWM 三环、MIT 力位混合；原理图 / PCB 设计}
\end{tabularx}}

% ── 荣誉与证书 ──
\mainsection{\faTrophy}{荣誉、证书与组织经历}
{\footnotesize
\renewcommand{\arraystretch}{0.80}
\begin{tabularx}{\linewidth}{@{}>{\raggedright\arraybackslash}X>{\raggedright\arraybackslash}X@{}}
{\bfseries\color{primary}研究生}\quad\textcolor{accent}{\faTrophy}\enspace 学业奖学金一等（2024、2025）；睿抗机器人国二（负责人） &
{\bfseries\color{primary}本科}\quad\textcolor{accent}{\faTrophy}\enspace 物联网设计大赛省一\\
\textcolor{accent}{\faTrophy}\enspace 三维数字化省一（2 项）；睿抗 ROS 省二 &
\textcolor{accent}{\faTrophy}\enspace 工程实践与创新省三；国家级大创负责人\\
\textcolor{accent}{\faTrophy}\enspace 高校机器人创意省二、省三 &
\textcolor{accent}{\faTrophy}\enspace 机械创新实验室负责人；智能制造协会会长\\
\textcolor{accent}{\faTrophy}\enspace 兼职辅导员（2024.09 -- 2025.07） &
\textcolor{accent}{\faTrophy}\enspace CET-4、计算机二级、C1 驾照
\end{tabularx}}

\end{document}
```

## Fragment: main.tex
```latex
% 整体字号：[10pt|11pt|12pt]  值越大字越大，占页越多
\documentclass[10pt]{article}

\usepackage{hyperref}
\usepackage{xcolor}
\usepackage{calc}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{fontspec}
\usepackage{fontawesome5}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{fancybox}
\usepackage{everypage}

\AddEverypageHook{\headerfooter}

\hypersetup{hidelinks}

%%%%%%%%%%%%%%%%%%%
% 设置
%%%%%%%%%%%%%%%%%%%

\setlength{\parindent}{0pt}
\pagenumbering{gobble}
\setlist[itemize]{nosep
    , before={\vspace*{-\parskip}}
    , leftmargin=*}
\setlist[enumerate]{leftmargin=*}
\setlist[itemize,2]{label={},leftmargin=0pt,nosep,itemindent=0pt,labelsep=0pt,labelwidth=0pt}
% 行距系数：越大行距越大，内容越松散
\renewcommand{\arraystretch}{1.05}
% 行距：0.8=紧凑  1.0=正常  1.2=宽松
\linespread{0.93}

\titleformat{\section}
  {\Large\bfseries\raggedright}
  {}{0em}
  {}
  [{\color{secondary_color}\titlerule}]
% 标题间距：前*0.3ex / 后*0.2ex  数值越大间隔越大
\titlespacing*{\section}{0cm}{*0.3}{*0.2}

% 页边距：值越大空白越多，内容越少
\usepackage[
    a4paper,
    left=1cm,
    right=1cm,
    top=1.1cm,
    bottom=0.9cm,
    nohead
]{geometry}

% 字体设置
\setmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold,
]{NotoSerifSC}

% 武科大配色
\definecolor{primary_color}{RGB}{0, 87, 63}
\definecolor{secondary_color}{RGB}{179, 163, 105}

\newlength{\iconwidth}
\setlength{\iconwidth}{1.2em}

% 允许中英混排时更灵活的断行，抑制 overfull
\tolerance=2000
\emergencystretch=3em
\hbadness=10000
\setlength{\hfuzz}{2pt}

%%%%%%%%%%%%%%%%%%%
% 自定义命令
%%%%%%%%%%%%%%%%%%%

\newcommand{\school}{机械工程学院 | School of Mechanical Engineering}

% 带图标的章节标题
\newcommand{\cvsection}[2]{%
    \section[#2]{\makebox[\iconwidth][c]{\color{primary_color}{#1}}\quad #2}%
}

% 经历条目：#1 机构/项目名  #2 角色  #3 时间
\newcommand{\cventry}[3]{%
    {\normalsize\textbf{#1}}，#2 \hfill #3\par
    % 条目后间距：越大条目间隔越大
    \vspace{0.15em}%
}

% 技能条目：#1 类别  #2 描述
\newcommand{\cvskill}[2]{\item \textbf{#1}：#2}

% ============================================================
% 间距控制（改大数值=增大间隔，改小=缩小间隔）
% ============================================================

% 条目间距：同一章节内不同项目之间的间隔
\newcommand{\entrygap}{\vspace{0.3em}}

% 章节间距：不同章节（如 教育背景→实习经历）之间的间隔
\newcommand{\sectiongap}{\vspace{0.5em}}

\newcommand{\contact}{
    \footnotesize
    \textcolor{white}{
        \faPhone \quad 15347348975
        \hspace{3em}
        \faEnvelope \quad \url{email:2408128687@qq.com}
        \hspace{3em}
        \faWeixin \quad 15096010804
    }
}

% 页眉页脚背景（多页共用） — 内容起始位置由 \vspace{} 控制，负值=上移
\newcommand{\headerfooter}{
    % 页眉
    \begin{tikzpicture}[remember picture, overlay]
        \node[anchor=north, inner sep=0pt](header) at (current page.north){
            \includegraphics[width=\paperwidth]{figures/header-darkgreen.png}
        };
        \node[anchor=west, yshift=-0.2cm](school_logo) at (header.west){
            \hspace{0.3cm}
            \includegraphics[width=0.3\textwidth]{figures/banner-white.png}
        };
        \node[anchor=east](school_name) at(header.east){
            \textcolor{white}{\textbf{\school}}
            \hspace{0.5cm}
        };
    \end{tikzpicture}
    % 页脚
    \begin{tikzpicture}[remember picture, overlay]
        \node[anchor=south, inner sep=0pt](footer) at (current page.south){
            \includegraphics[width=\paperwidth]{figures/footer-darkgreen.png}
        };
        \node[anchor=center] at(footer.center){\contact};
    \end{tikzpicture}
    % 背景水印
    \begin{tikzpicture}[remember picture, overlay]
        \node[opacity=0.04] at(current page.center){
            \includegraphics[width=0.6\paperwidth, keepaspectratio]{figures/logo.pdf}
        };
    \end{tikzpicture}
    \vspace{-1em}
}

\begin{document}

%%%%%%%%%%%%%%%%%%%
% 第一页
%%%%%%%%%%%%%%%%%%%
\headerfooter

\vspace{0.5em}   % 这里往下移动，数值越大下移越多
\begin{minipage}[t]{0.80\textwidth}
    % 个人信息
    \begin{minipage}[t]{\textwidth}
    \cvsection{\faAddressCard}{个人信息}

    \begin{minipage}[t]{0.48\textwidth}
        \textbf{姓\qquad 名}：肖琦

        \vspace{0.15em}
        \textbf{出生年月}：2002 年 11 月

        \vspace{0.15em}
        \textbf{籍\qquad 贯}：湖南衡阳

        \vspace{0.15em}
        \textbf{求职意向}：嵌入式/Linux开发
    \end{minipage}%
    \begin{minipage}[t]{0.48\textwidth}
        \textbf{性\qquad 别}：男

        \vspace{0.15em}
        \textbf{政治面貌}：中共党员

        % \vspace{0.15em}
        % \textbf{期望薪资}：13--17K

        \vspace{0.15em}
        \textbf{期望城市}：深圳、长沙
    \end{minipage}

\end{minipage}

\vspace{0.4em}   % 减小间隙

    % 教育背景
    \begin{minipage}[t]{\textwidth}
    \cvsection{\faGraduationCap}{教育背景}

    \cventry{武汉科技大学}{硕士 · 机械专业（专硕）}{2024.09 -- 2027.06}
    \begin{itemize}
        \item \textbf{研究方向}：智能机器人、控制算法、轮腿机器人、强化学习
        \item \textbf{综合排名}：5/176，\textbf{课程均分}：83.5
    \end{itemize}

    \entrygap
    \cventry{湖南工学院}{学士 · 机械设计制造及其自动化}{2020.09 -- 2024.06}
    \begin{itemize}
        \item \textbf{主修课程}：机械工程控制原理、数电与模电、单片机应用、机械设计与机械原理
        \item \textbf{班级排名}：1/43，\textbf{专业排名}：3/164
    \end{itemize}
    \end{minipage}
\end{minipage}%
\hfill
% 照片
\begin{minipage}[t]{0.175\textwidth}
    \vspace{0.8em}
    \setlength{\fboxsep}{0pt}
    \doublebox{\includegraphics[width=0.95\linewidth]{figures/amater.jpg}}
\end{minipage}

\sectiongap

% 工作经历
\begin{minipage}[t]{\textwidth}
\cvsection{\faBriefcase}{实习经历}

\cventry{武汉格蓝若智能技术股份有限公司}{嵌入式实习生 · 人形/四足机器人底层控制开发}{2025.11 -- 2026.06}
\begin{itemize}
    \item \textbf{主要工作：}主要参与人形机器人M2、四足机器人D1及货仓机器人的嵌入式系统研发，负责Linux驱动、STM32实时固件
                                    BMS电源管理及多协议通信的开发与调试，实习期间独立完成4个关键模块的交付。
    \item \textbf{项目一:}基于Linux的人形机器人关节电机驱动开发  
    \item \textbf{技术栈:}RK3588 / 多线程 / C++ / PCIe-to-CAN / EtherCAT / CANopen(SDO) / RS485 / ROS2
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}自研电机，卓誉关节电机，达妙电机等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}硬件链路层：M.2接口实现PCIe至六路CAN的协议转换与信号适配，然后通过CAN分析仪进行长时间满载数据抓包
                                        与回环压力测试。
        \item 2.\hspace{0.3em}驱动与中间件移植：先基于Makefile完成单电机驱动原型验证；后将驱动架构完整移植至ROS2框架，采用CMake
                                            重构工程，实现六路CAN总线的多线程并发控制，并封装标准化服务/话题接口，实现与算法部门的无缝对接。
        \item 3.\hspace{0.3em}协议栈解析：解析电机私有协议，基于CANopen协议规范（SDO/PDO）构建电机对象字典模型，完整支持位置、
                                        速度、力矩、MIT（阻抗） 及回零五种控制模式，并开放参数在线修改与故障诊断接口。
    \end{itemize}

    \item \textbf{项目二:}六维力传感器高精度数据采集系统（STM32 + EtherCAT）  
    \item \textbf{技术栈:}STM32F4 / HAL库 / RTOS / SPI / SIG5632/34/MAX11254 / EtherCAT（AX58100）/ CANFD
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}驱动、滤波、adc -> 力解析等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}高精度采样实现：使用STM32CUBEMX配置HAL库，驱动SPI接口的SIG5632/34芯片，配置PGA可编程增益放大器
                                            与Σ-Δ调制器，实现6路高精度高速adc采样，将采用数据通过力矩阵解析为六维力信号的32位高精度数字输出，通过IO
                                            外部中断触发同步采样。
        \item 2.\hspace{0.3em}实时工业以太网：AX58100（EtherCAT从站控制器）与STM32的通信机制，将ADC采集的力/力矩数据打包映射至
                                        EtherCAT过程数据对象（PDO），实现了与上位机主站实时数据交互。
    \end{itemize}

    \item \textbf{项目三:}货仓机器人底盘控制与末端执行器驱动开发
    \item \textbf{技术栈:}STM32 / RS485/CAN / 霍尔编码器 / PID / MOSFET/栅极驱动
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}底盘驱动、末端驱动，协议适配等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}升降立柱控制：机器人下半身控制，一是网线端水晶头连接实现按键控制与调试，二是上位端RS485通信控制，实现
                                        与机器人大脑连接节点发布订阅控制。
        \item 2.\hspace{0.3em}双臂末端执行器开发：实现电推杆夹取与气泵吸盘两种抓取模式，针对轻小物体优化吸盘控制逻辑。
    \end{itemize}

    \item \textbf{项目四:}双足/四足机器人BMS电源板管理与状态机设计
    \item \textbf{技术栈:}STM32 / 状态机设计 / 多级优先级调度 / CAN/RS485/USART / 远程控制 / bootloader(OTA)
    \item \textbf{工作与成果}：\hfill {\textbf{负责：}M2、D1电源板控制、BMS管理等}
    \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
        \item 1.\hspace{0.3em}电源系统设计：针对人形机器人M2和机器狗D1设计双电池冗余管理方案，集成过压/欠压保护、泄压电路及刹车能
                                        量泄放电路；通过3路RS485、2路CAN及1路USART实时监测电池电量、温度、电流及电压
                状态。
        \item 2.\hspace{0.3em}三级安全控制策略：定义硬件急停（最高优先级）、远程RF遥控急停与上位软件指令的优先级仲裁机制。
        \item 3.\hspace{0.3em}状态机（FSM）实现：初始化 → 安全 → 就绪 → 上电 的主流程，并处理急停/故障到安全/就绪的异常跳
                转与复位逻辑，软件指令（A/B/C键）与远程命令协同控制电源上下电。

    \end{itemize}

    \item \textbf{项目链接}：\url{https://github.com/ruanjianshi/motor-drive_power-board_six-force}
\end{itemize}


% 专业技能
\vspace{0.1em} 
\cvsection{\faWrench}{专业技能}

\begin{itemize}
\setlength{\itemsep}{0.15em}
    \cvskill{嵌入式开发}{熟练 STM32（固件库 / HAL）、ESP32、FreeRTOS，RTthread, LVGL, Tessy}
    \cvskill{Linux 开发}{应用编程、多线程、makefile / cmake、gdb、UDP / TCP、MQTT}
    \cvskill{通信协议}{USART、SPI、I\textsuperscript{2}C、RS485、CANopen、CAN FD、EtherCAT、LIN、UDS}
    \cvskill{电机驱动}{无刷 FOC 与滤波，位置 / 速度 / 电流环 PID，MIT 力位混合控制}
    \cvskill{机器人系统}{ROS1 / ROS2、Gazebo / Webots 仿真、SLAM、YOLO、MoveIt}
    \cvskill{机器人算法}{LQR、MPC、VMC、ADP；SAC / PPO 等强化学习，sim2sim / sim2real}
    \cvskill{工具与平台}{Isaac Gym / MuJoCo / UniLab；嘉立创 EDA / AD（PCB）、AutoCAD、SolidWorks}
    \cvskill{编程语言}{C / C++（STL）、Python、MATLAB（Simulink 仿真）}
\end{itemize}

% 社团与实验室经历
\begin{minipage}[t]{\textwidth}
\cvsection{\faUsers}{社团与实验室经历}

\cventry{智能制造协会}{会长 · 协会创立与全面管理}{2022.06 -- 2023.09}
\cventry{机械创新实验室}{负责人 · 嵌入式培训与带队竞赛}{2021.06 -- 2024.06}
\cventry{魔术协会}{技术部成员}{2020.11 -- 2021.06}
\end{minipage}

\end{minipage}


\sectiongap


\sectiongap

% 项目经历（首页）
\begin{minipage}[t]{\textwidth}

\vspace{0.3em}   % 或您想要的数值，让第二页内容整体下移
\cvsection{\faFlask}{项目经历}

\cventry{小型人形机器人开发}{主控负责}{2026.06 -- 2026.09}
\begin{itemize}
    \item \textbf{主要工作：}聚焦于高约0.8m、22自由度人形机器人全栈开发，涵盖结构设计、ROS2控制、强化学习训练与sim2real实机
                            部署，实现从仿真到实机的完整闭环。

    \item \textbf{技术栈：}RDK5 / ROS2 / CANFD / 高擎HTDW(MIT) / Isaac Gym(PPO)→ONNX→RKNN / MuJoCo

    \item \textbf{工作与成果：}\hfill {\textbf{负责：}结构、控制、训练与部署}
    \begin{itemize}[label=-, leftmargin=0.8em, labelsep=0.5em]
        \item 1.\hspace{0.3em}底层控制：编写HTDW电机ROS2驱动（MIT力位混合模式），实现CANFD多节点通信（4路CANFD，每路挂5到7
                                    个电机）；完成IMU数据采集（USB2USART）及姿态解算。
        \item 2.\hspace{0.3em}强化学习训练：Isaac Gym+PPO进行步态训练，设计奖励函数，策略输出.pt→ONNX→RKNN部署，并在MuJoCo
                                        中完成sim2sim验证与参数调优。
    \end{itemize}

    \item \textbf{项目链接：}\url{https://github.com/ruanjianshi/humanrobot_ros2_sim2real}
\end{itemize}


\entrygap
\cventry{四连杆两轮腿机器人开发设计（轮+足）}{独立开发}{2026.01 -- 2026.09}
\begin{itemize}
    \item \textbf{主要工作：}聚焦于大型四连杆机构轮腿机器人全栈开发，具备轮/足切换功能，完成从结构设计、四层自制板卡（Jetson Nano拓展板+DCU+BMS）、ROS1控制、UniLab强化学习训练到sim2real实机部署的完整闭环。

    \item \textbf{技术栈：}Jetson Nano / ROS1 / EtherCAT转CANFD(5M) / 四层自制板卡(BMS+DCU) / UniLab(PPO) / MuJoCo仿真 / 智元R86/R52电机 / 轻量化连杆结构

    \item \textbf{工作与成果：}\hfill {\textbf{负责：}结构、硬件、控制、训练与部署}
    \begin{itemize}[label=-, leftmargin=0.8em, labelsep=0.5em]
        \item 1.\hspace{0.3em}结构设计：完成整机SolidWorks建模、URDF导出、STL优化与碰撞简化，足端可拆卸设计，膝关节从不完全齿轮+
                                        连杆替代丝杆驱动，提升响应速度；外壳3D打印+机加工骨架，集成7寸屏幕、雷达与RGB-D相机。
        \item 2.\hspace{0.3em}硬件系统：设计四层叠板架构（JetsonNano核心板+自制拓展板（供电/DC-DC/SPI转RS485/CAN）+DCU（Ether
                                        CAT转4路CANFD，5Mbps）+ BMS电源板（过/欠压保护、泄放、急停与遥控））。
        \item 3.\hspace{0.3em}底层控制：编写智元R86/R52电机ROS1驱动（MIT力位混合模式），实现EtherCAT→CANFD协议栈与IMU数据采
                                        集（USB2USART）�������������定义话题/服务接口。
        \item 4.\hspace{0.3em}强化学习与部署：基于UniLab+PPO进行步态训练并设计奖励函数，策略输出.pt→ONNX，MuJoCo做sim2sim验证
                                        完成sim2real实机迁移（输入42维→输出8维，乘action\_scale），调试PD参数、电机ID与零点校准。
    \end{itemize}

        \item \textbf{项目链接：}%
        \mbox{\url{https://github.com/ruanjianshi/wheel_legged_RL_unilab\\Jetson_nano_X1\\stm32-trolley}}
        
    
%\item \textbf{项目链接：}\url{https://github.com/ruanjianshi/wheel_legged_RL_unilab}（强化学习算法）\\
%       \hspace*{5.0em}\url{https://github.com/ruanjianshi/Jetson_nano_X1}（上层驱动）\\
%      \hspace*{5.0em}\url{https://github.com/ruanjianshi/Wheel-leg-ros2-and-stm32-trolley}（底层驱动）
\end{itemize}

\entrygap
\cventry{基于STM32和OpenMV的智能物流小车}{主控代码撰写}{2025.08 -- 2025.09}
\begin{itemize}
    \item \textbf{主要工作：}设计并实现一款高度自主运行的物流小车，涵盖麦克纳姆轮底盘搭建、机械臂抓取机构组装、电机驱动/超声波
                            避障/蓝牙通讯/视觉识别硬件架构搭建，以及自动分拣与路径规划软件逻辑开发。

    \item \textbf{技术栈：}STM32F407 / FreeRTOS / 麦克纳姆轮运动学 / 520编码电机 / OpenMV4(颜色/形状识别) / UART通信 / 超声波避障

    \item \textbf{工作与成果：}\hfill {\textbf{负责：}硬件选型、主控代码、视觉算法}
    \begin{itemize}[label=-, leftmargin=0.8em, labelsep=0.5em]
        \item 1.\hspace{0.3em}硬件选型与搭建：选用麦克纳姆轮底盘+4个520直流编码电机；STM32F407作为主控；42步进电机驱动滑轨升降，舵
                                            机控制云台旋转与夹爪张合；超声波测距避障；OpenMV4 H7 Plus视觉识别，预留蓝牙调试接口。
        \item 2.\hspace{0.3em}主控软件：基于STM32固件库与FreeRTOS实时操作系统，编写小车全自动控制流程（路径规划→视觉识别→抓取→
                                    搬运→释放）。
        \item 3.\hspace{0.3em}视觉识别算法：基于OpenMV4实现颜色识别（红/蓝/绿/灰/黄）与形状识别（五角星/三角形/正方形/矩形），以及颜
                                            色区域识别，通过UART串口与底盘双向通信，实现物料自动分拣。
    \end{itemize}

    \item \textbf{项目链接：}\url{https://github.com/ruanjianshi/Table-trolley}
\end{itemize}


\entrygap
\cventry{基于车灯控制的MCU开发项目}{车灯控制器}{2025.06 -- 2025.09}
\begin{itemize}
    \item \textbf{主要工作：}参与多款车灯控制器（前组合灯/氛围灯）的应用开发，涵盖应用层逻辑设计、底层驱动调试（SPI/CAN/
                            LIN）、tessy测试、灯光联调。前组合灯平台项目交付，同步参与（CANFD升级平台）与（氛围灯）。
        \item \textbf{项目一:}前组合灯控制器、内饰氛围灯  
        \item \textbf{技术栈:}YTM32B1MC03/MD24（Cortex-M33）｜ GD32A503RC｜ AUTOSAR ｜ CAN / CANFD / LIN｜ UDS｜ SPI｜  IAR / CMake
\item \textbf{工作与成果}：\hfill {\textbf{负责：}灯光控制、应用层开发等}
        \begin{itemize}[label=-, leftmargin=0.8em,labelsep=0.5em]
            \item 1.\hspace{0.3em}灯光逻辑调度：前组合灯（近光/远光/转向/日行/雾灯/LOGO等）控制策略设计，在20ms硬实时周期内完成"信号
                                            解析→优先级仲裁→驱动输出→状态回发"完整闭环。针对平台扩展至5种灯语与ADS自适应大灯互斥逻辑，并新增
                                            档位电机控制。
            \item 2.\hspace{0.3em}电源与热管理：5态电压滞回监控策略，结合电压/NTC双路降额算法，在车载电源波动或LED过热时主
                    动降额保护
            \item 3.\hspace{0.3em}恒流驱动开发：驱动BOOST升压+2路Buck降压恒流拓扑（SPI四通道），编写40ms周期故障巡检任务，通过回读输
                                            出电压精准判断开路（30~34V阈值）。
            \item 4.\hspace{0.3em}一版固件兼容左右灯:GPIO\_LR 识别 + 运行时动态切换诊断地址（RX 0x721/0x732、TX 0x7A1/0x7B2）
                    与状态/DTC 报文 ID（0x420/0x421、0x4BC/0x4BD）。
        \end{itemize}
\end{itemize}

\end{minipage}


\vspace{0.1em} 

% 荣誉证书（通栏双列）
\begin{minipage}[t]{\textwidth}
\cvsection{\faTrophy}{荣誉证书}

\begin{minipage}[t]{0.485\textwidth}
    \textbf{研究生阶段}
    \begin{itemize}[nosep]
        \item 研究生学业奖学金一等奖（2024、2025）
        \item 睿抗机器人开发者大赛国二等奖（负责人）
        \item 睿抗 ROS 机器人挑战赛省二等奖（负责人）
        \item 三维数字化创新设计大赛省一等奖（负责人）
        \item 高校机器人创意大赛省二 / 省三等奖
        \item 兼职辅导员（2024.09 -- 2025.07）
    \end{itemize}
\end{minipage}%
\hfill
\begin{minipage}[t]{0.485\textwidth}
    \textbf{本科阶段}
    \begin{itemize}[nosep]
        \item 湖南省物联网设计大赛一等奖
        \item 湖南省机械创新设计大赛二等奖
        \item 湖南省工程实践与创新能力大赛三等奖
        \item 国家级大创项目负责人
        \item 校级一等奖学金、校级优秀毕业生
    \end{itemize}
\end{minipage}
\end{minipage}

\vspace{0.1em} 

% 资格证书 / 个人格言
\begin{minipage}[t]{0.485\textwidth}
    \cvsection{\faIdCard}{资格证书}
    \begin{itemize}[nosep]
        \item 大学英语六级（CET-6）、四级（CET-4）
        \item 计算机二级、驾驶证 C1
    \end{itemize}
\end{minipage}%
\hfill
\begin{minipage}[t]{0.485\textwidth}
    \cvsection{\faStar}{个人格言}
    \begin{itemize}[nosep]
        \item 热爱技术，无限进步
        \item \footnotesize Passion for tech. Progress without limits.
    \end{itemize}
\end{minipage}

\end{document}
```

## Fragment: singleresume.bak
```latex
\documentclass[10pt]{article}

\usepackage[a4paper,margin=0pt]{geometry}
\usepackage{xcolor}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{fontspec}
\usepackage{xeCJK}
\usepackage{fontawesome5}
\usepackage{enumitem}
\usepackage{hyperref}

\setmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold
]{NotoSerifSC}
\setCJKmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold
]{NotoSerifSC}

\definecolor{sidebar}{HTML}{173E35}
\definecolor{primary}{HTML}{173E35}
\definecolor{accent}{HTML}{C8A45D}
\definecolor{ink}{HTML}{18212A}
\definecolor{muted}{HTML}{64717D}
\definecolor{soft}{HTML}{EDF3F0}

\hypersetup{
    colorlinks=true,
    urlcolor=accent,
    linkcolor=primary
}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\fboxsep}{0pt}
\linespread{1.04}
\emergencystretch=2em
\setlist[itemize]{
    leftmargin=1.15em,
    itemsep=0.12em,
    topsep=0.16em,
    parsep=0pt,
    label=\textcolor{accent}{\textbullet}
}

\newcommand{\sidesection}[2]{%
    \vspace{0.75em}
    {\normalsize\bfseries\color{white}#1\hspace{0.55em}#2}\par
    \vspace{0.2em}
    {\color{accent}\rule{\linewidth}{0.75pt}}\par
    \vspace{0.35em}
}
\newcommand{\mainsection}[2]{%
    \vspace{0.55em}
    {\Large\bfseries\color{primary}#1\hspace{0.55em}#2}\par
    \vspace{0.18em}
    {\color{accent}\rule{\linewidth}{0.8pt}}\par
    \vspace{0.35em}
}
\newcommand{\skill}[2]{%
    {\makebox[0.78em][l]{\color{accent}\scriptsize\faAngleRight}%
     \bfseries\color{white}#1}\par
    \vspace{0.08em}
    {\small\color{white!78}#2}\par
    \vspace{0.42em}
}
\newcommand{\contactline}[2]{%
    \makebox[1.55em][c]{#1}\hspace{0.45em}#2\par
    \vspace{0.3em}
}
\newcommand{\awardgroup}[2]{%
    \begingroup
    \setlength{\fboxsep}{3pt}%
    \colorbox{soft}{\makebox[\dimexpr\linewidth-6pt][l]{%
        \color{primary}\small\bfseries #1\hspace{0.45em}#2}}%
    \endgroup\par
    \vspace{0.28em}
}
\newcommand{\awarditem}[1]{%
    \makebox[0.9em][l]{\color{accent}\scriptsize\textbullet}%
    {\small #1}\par
    \vspace{0.05em}
}
\newcommand{\entryhead}[3]{%
    {\large\bfseries\color{ink}#1}\hfill{\small\color{muted}#3}\par
    {\small\bfseries\color{primary}#2}\par
    \vspace{0.1em}
}

\begin{document}

% 深绿色侧栏背景
\begin{tikzpicture}[remember picture,overlay]
    \fill[sidebar] (current page.north west)
      rectangle ([xshift=0.305\paperwidth]current page.south west);
    \fill[accent] ([xshift=0.305\paperwidth]current page.north west)
      rectangle ([xshift=0.309\paperwidth]current page.south west);
\end{tikzpicture}
\vspace*{-\baselineskip}

\noindent
\begin{minipage}[t]{0.305\paperwidth}
    \vspace{0.75cm}
    \hspace*{0.038\paperwidth}%
    \begin{minipage}[t]{0.229\paperwidth}
        \color{white}
        \begin{center}
            \begin{tikzpicture}
                \clip (0,0) circle (1.47cm);
                \node at (0,-0.02) {\includegraphics[width=3.02cm]{figures/amater.jpg}};
            \end{tikzpicture}

            \vspace{0.2em}
            {\small\color{white!75}嵌入式系统 · Linux · 机器人}
        \end{center}

        \sidesection{\faAddressBook}{联系方式}
        {\small
        \contactline{\faPhone}{15347348975}
        \contactline{\faEnvelope}{\href{mailto:2408128687@qq.com}{2408128687@qq.com}}
        \contactline{\faWeixin}{xiao15096010804}
        \contactline{\faMapMarker*}{湖南省衡阳}}

        \sidesection{\faGraduationCap}{教育背景}
        {\bfseries 武汉科技大学}\hfill
        {\scriptsize\color{white!82}2024.09 -- 2027.06}\par
        {\small\color{white!82}机械专业硕士（专硕）\par
        研究生初试总分：363,   位列前十\par
        综合排名 5/172 · 均分 83.5\par}
        \vspace{0.55em}
        {\bfseries 湖南工学院}\hfill
        {\scriptsize\color{white!82}2020.09 -- 2024.06}\par
        {\small\color{white!82}机械设计制造及其自动化\par
        班级 1/43 · 专业 3/164\par}

        \sidesection{\faTools}{专业技能}
        \skill{编程与构建}{C / C++、Python、Shell；CMake / Makefile、Git}
        \skill{嵌入式 Linux}{系统调用、文件I/O、进程/线程、Socket；交叉编译、GDB与设备接口调试}
        \skill{MCU 与 RTOS}{STM32、FreeRTOS / RT-Thread；中断、DMA、Bootloader与状态机}
        \skill{通信与现场总线}{CAN / CANFD / CANopen、EtherCAT、RS485、SPI、I\textsuperscript{2}C、UART}
        \skill{控制与机器人}{FOC、PID、MIT、LQR、MPC、VMC；ROS1 / ROS2、PPO与sim2real}
        \skill{仿真与硬件工具}{Isaac Gym、MuJoCo、UniLab；SolidWorks、嘉立创EDA / AD}

        \sidesection{\faCertificate}{证书与身份}
        {\small
        中共党员\par
        % \vspace{0.25em}
        % 大学英语六级（CET-6）\par
        \vspace{0.25em}
        大学英语四级（CET-4）\par
        \vspace{0.25em}
        计算机二级 · 驾驶证 C1\par}

        \vspace{-0.18em}
        \sidesection{\faQuoteLeft}{个人格言}
        \vspace{-0.22em}
        {\centering
            {\small\bfseries\color{accent}热爱技术，无限进步}\par
            \vspace{0.10em}
            {\scriptsize\itshape\color{white!60}
            Passion for tech.\enspace Progress without limits.}
            \par}
    \end{minipage}
\end{minipage}%
\begin{minipage}[t]{0.695\paperwidth}
    \vspace{0.9cm}
    \hspace*{0.038\paperwidth}%
    \begin{minipage}[t]{0.615\paperwidth}
        {\fontsize{27}{31}\selectfont\bfseries\color{ink}肖琦}\par
        \vspace{0.16em}
        {\large\color{primary}嵌入式 / Linux 开发工程师}\par
        \vspace{0.28em}
        {\small\color{muted}武汉科技大学 · 机械工程学院 \quad 2027届硕士}\par
        \vspace{0.45em}
        {\color{accent}\rule{2.5cm}{2pt}}\par
        \vspace{0.35em}
        {\small\color{ink}
        聚焦嵌入式底层、Linux应用驱动及机器人姿态控制，具备从硬件接口、实时固件、
        通信协议到ROS系统集成与实机部署的完整开发经验，能够独立完成方案验证、联调与问题定位。}

        \mainsection{\faBriefcase}{实习经历}
        \entryhead{武汉格蓝若智能技术股份有限公司}
          {嵌入式实习生 · 人形/四足机器人底层控制}
          {2025.11 -- 2026.06}
        {\small\textbf{技术栈：}RK3588、C++、CMake、ROS2、PCIe-to-CAN、CANopen、STM32F4、SPI ADC、EtherCAT}
        \begin{itemize}
            \item \textbf{Linux关节驱动：}在RK3588上以C++ / CMake实现六路CAN多线程并发控制，使用CAN分析仪完成满载抓包与回环测试，并封装ROS2话题/服务接口。
            \item 构建CANopen对象字典，支持位置、速度、力矩、MIT和回零模式，并开放在线参数配置与故障诊断。
            \item \textbf{六维力传感器：}基于STM32F4、SPI ADC和外部中断完成6路高精度同步采样、PGA配置、数字滤波及力矩阵解算，并通过AX58100 EtherCAT PDO实时上报。
            \item \textbf{机器人电源板管理：}设计双电池冗余、过欠压和制动能量泄放方案，通过3路RS485、2路CAN及USART监测电量、温度、电流与电压。
            \item 实现硬件急停、RF遥控、软件指令的三级优先级仲裁，以及“初始化--安全--就绪--上电--异常恢复”状态机。
        \end{itemize}
        {\footnotesize\color{muted}\faGithub\quad
        源码：\nolinkurl{https://github.com/ruanjianshi/motor-drive_power-board_six-force}}

        \mainsection{\faProjectDiagram}{项目经历}
        \entryhead{四连杆两轮腿机器人（轮 + 足）}
          {独立开发 · 结构 / 硬件 / 控制 / 部署}
          {2026.01 -- 2026.09}
        \begin{itemize}
            \item \textbf{技术栈：}Jetson Nano、ROS1、EtherCAT、CANFD、UniLab（PPO）、MuJoCo、智元R86 / R52。
            \item 完成SolidWorks整机结构、URDF、STL碰撞简化和四层板卡设计，并集成7寸屏幕、雷达与RGB-D相机。
            \item 开发Jetson Nano拓展板、EtherCAT转4路CAN FD的DCU及安全BMS，完成供电、通信、急停与保护链路联调。
            \item 编写智元R86 / R52电机MIT模式驱动和IMU接口；完成PPO步态训练、sim2sim验证、sim2real迁移与PD参数调优。
        \end{itemize}
        {\footnotesize\color{muted}\faGithub\quad
        强化学习：\nolinkurl{https://github.com/ruanjianshi/wheel_legged_RL_unilab}\par
        \hspace*{1.45em}Jetson上层：\nolinkurl{https://github.com/ruanjianshi/Jetson_nano_X1}\par
        \hspace*{1.45em}STM32底层：\nolinkurl{https://github.com/ruanjianshi/Wheel-leg-ros2-and-stm32-trolley}}\par

        \vspace{0.6em}
        \entryhead{STM32 / OpenMV 智能物流小车}
          {主控代码撰写 · 运动控制 / 视觉识别}
          {2025.08 -- 2025.09}
        {\small\textbf{技术栈：}STM32F407、FreeRTOS、麦克纳姆轮、OpenMV4 H7 Plus、UART、超声波}
        \begin{itemize}
            \item 基于STM32F407 + FreeRTOS实现麦克纳姆轮底盘、执行机构和超声波避障，组织“规划--识别--抓取--搬运--释放”自动流程。
            \item 在OpenMV4上实现红、蓝、绿、灰、黄等颜色及三角形、矩形等形状识别，通过UART与底盘双向通信，完成物料定位及自动分拣。
            \item 完成编码电机、步进电机、舵机与视觉模块的协同调试，并预留蓝牙参数调试接口。
        \end{itemize}
        {\footnotesize\color{muted}\faGithub\quad
        源码：\nolinkurl{https://github.com/ruanjianshi/Table-trolley}}\par

        \mainsection{\faTrophy}{荣誉与经历}
        \begin{minipage}[t]{0.49\linewidth}
            \awardgroup{\faGraduationCap}{研究生阶段}
            \awarditem{\textbf{学业奖学金一等奖} \textcolor{muted}{· 2024、2025}}
            \awarditem{睿抗机器人开发者大赛 \textbf{国家二等奖}}
            \awarditem{三维数字化创新设计大赛 \textbf{省一等奖}}
            \awarditem{睿抗ROS机器人挑战赛 \textcolor{muted}{省二等奖}}
            \awarditem{高校机器人创意大赛 \textcolor{muted}{省二、三等奖}}
        \end{minipage}%
        \hfill
        \begin{minipage}[t]{0.47\linewidth}
            \awardgroup{\faAward}{本科及组织经历}
            \awarditem{湖南省物联网设计大赛 \textbf{省一等奖}}
            \awarditem{湖南省机械创新设计大赛 \textcolor{muted}{省二等奖}}
            \awarditem{工程实践与创新能力大赛 \textcolor{muted}{省三等奖}}
            \awarditem{\textbf{国家级大创项目负责人}}
            \awarditem{智能制造协会 \textcolor{muted}{会长}}
            \awarditem{机械创新实验室 \textcolor{muted}{负责人}}
        \end{minipage}
    \end{minipage}
\end{minipage}

\end{document}
```

## Fragment: resume-mech
```latex
\documentclass[10pt]{article}

\usepackage[a4paper,left=1.00cm,right=1.00cm,top=0.45cm,bottom=0.35cm]{geometry}
\usepackage{xcolor}
\usepackage{graphicx}
\usepackage{tikz}
\usepackage{fontspec}
\usepackage{xeCJK}
\usepackage{fontawesome5}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{tabularx}
\usepackage{array}
\usepackage{titlesec}

\setmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold
]{NotoSerifSC}
\setCJKmainfont[
    Path=fonts/,
    Extension=.otf,
    BoldFont=*-Bold
]{NotoSerifSC}

\definecolor{primary}{HTML}{173E35}
\definecolor{accent}{HTML}{B68B38}
\definecolor{ink}{HTML}{18212A}
\definecolor{muted}{HTML}{64717D}
\definecolor{soft}{HTML}{EDF3F0}
\definecolor{line}{HTML}{D5DFDB}

\hypersetup{
    colorlinks=true,
    urlcolor=accent,
    linkcolor=primary
}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\linespread{0.885}
\emergencystretch=3em
\tolerance=1800
\setlist[itemize]{
    leftmargin=1.20em,
    itemsep=0.04em,
    topsep=0.07em,
    parsep=0pt,
    partopsep=0pt,
    label=\textcolor{accent}{\scriptsize\faCircle}
}

\newcommand{\mainsection}[2]{%
    \vspace{0.20em}
    \noindent\hbox to \linewidth{{\large\bfseries\color{primary}%
    \makebox[1.45em][c]{#1}\hspace{0.35em}#2}\hspace{0.55em}%
    {\color{accent}\leaders\hrule height 0.9pt\hfill\kern0pt}}\par
    \vspace{0.04em}
}
\newcommand{\entryhead}[3]{%
    \begin{tabularx}{\linewidth}{@{}>{\raggedright\arraybackslash}p{7.2cm}>{\centering\arraybackslash}X>{\raggedleft\arraybackslash}p{3.2cm}@{}}
    {\normalsize\bfseries\color{ink}#1} &
    {\footnotesize\bfseries\color{primary}#2} &
    {\footnotesize\bfseries\color{muted}#3}
    \end{tabularx}\vspace{0.00em}
}
\newcommand{\tech}[1]{%
    {\footnotesize\color{muted}\textbf{技术栈}\enspace #1}\par\vspace{0.03em}
}
\newcommand{\skillrow}[2]{%
    \textbf{\color{primary}#1} & #2\\[0.10em]
}
\newcommand{\awarditem}[1]{%
    \makebox[1.05em][l]{\color{accent}\scriptsize\faTrophy}%
    {\footnotesize #1}\par\vspace{0.02em}
}

\begin{document}
% ⚠️ 压成 1 页用的：整篇缩到 9.5pt（标题是显式 \fontsize，不受影响 ✓）
\fontsize{9.5}{10.6}\selectfont

% ===== 顶部身份信息 =====
\noindent
\begin{minipage}[c]{0.80\linewidth}
    {\fontsize{25}{28}\selectfont\bfseries\color{ink}肖琦}\par
    \vspace{0.16em}
    {\footnotesize\color{muted}
    \faPhone\enspace 15347348975 \quad
    \faEnvelope\enspace\href{mailto:2408128687@qq.com}{2408128687@qq.com} \quad
    \faWeixin\enspace xiao15096010804\par
    \faMapMarker*\enspace 湖南省衡阳 \quad
    \faFlag\enspace 中共党员 \quad
    \faBriefcase\enspace 深圳 / 长沙 / 惠州}
\end{minipage}%
\begin{minipage}[c]{0.19\linewidth}
    \raggedleft
    \begin{tikzpicture}
        \clip (0,0) circle (1.00cm);
        \node at (0,-0.01) {\includegraphics[width=2.10cm]{figures/amater.jpg}};
        \draw[accent,line width=1.1pt] (0,0) circle (1.00cm);
    \end{tikzpicture}
\end{minipage}

\vspace{0.08em}
{\color{primary}\rule{\linewidth}{1.5pt}}

% ===== 个人情况 =====
\mainsection{\faUser}{个人情况}
{\footnotesize
\begin{tabularx}{\linewidth}{@{}p{3.7cm}p{5.8cm}X@{}}
\textbf{出生年月}：2002.11 &
\textbf{求职意向}：机械结构设计 &
\textbf{技术方向}：机构设计、传动结构、产品结构、工艺与装配
\end{tabularx}}
\vspace{0.15em}
\noindent\makebox[2.65cm][l]{\bfseries\color{primary}武汉科技大学}%
机械专业硕士（专硕）· 机械工程学院\hfill{\color{muted}2024.09 -- 2027.06}\par
\hspace*{2.65cm}{\footnotesize 初试总分363（位列前十），综合排名5/172，课程均分83.5}\par
\vspace{0.10em}
\noindent\makebox[2.65cm][l]{\bfseries\color{primary}湖南工学院}%
机械设计制造及其自动化\hfill{\color{muted}2020.09 -- 2024.06}\par
\hspace*{2.65cm}{\footnotesize 班级排名1/43，专业排名3/164；机械创新实验室负责人}\par
\vspace{0.14em}
\colorbox{soft}{\parbox{\dimexpr\linewidth-2\fboxsep\relax}{\footnotesize\color{ink}
\textbf{岗位优势}\enspace 机械设计制造及其自动化本科 + 机械专硕：能独立完成\textbf{机构选型 → 结构设计 → 出工程图 → 选材工艺 → 加工装配 → 测试出报告}的完整闭环；熟练 SolidWorks / Creo / AutoCAD，做过连杆、凸轮、齿轮、带传动、绳驱等多类机构，也有消费电子（键轴 / 微动开关）的\textbf{量产结构}与产线工艺经验。}}

% ===== 实习经历 =====
\mainsection{\faBriefcase}{实习经历}
\entryhead{武汉格蓝若智能技术股份有限公司}
  {结构设计实习生 · 人形与四足机器人}
  {2025.11 -- 2026.06}
\tech{SolidWorks、URDF、STL 网格优化、碰撞模型简化、惯量计算、3D 打印、工程图机加工、装配与干涉排查}
\begin{itemize}
    \item \textbf{整机建模与结构件设计：}参与人形 / 四足机器人整机三维建模与结构件设计，完成 \textbf{URDF 制作与处理、STL 面片优化、碰撞模型简化、惯量计算}。
    \item \textbf{结构件加工与装配：}负责结构件的 3D 打印与工程图机加工，跟进装配与干涉排查，按装配反馈迭代结构细节。
\end{itemize}

\vspace{0em}
\entryhead{惠州正牌科电有限公司}
  {研发助理工程师 · 键轴 / 微动开关}
  {2024.06 -- 2024.09}
\tech{Creo、AutoCAD、CAD 工程图、公差配合、磁轴结构、微动开关、外观件设计、寿命与力学测试}
\begin{itemize}
    \item \textbf{磁轴结构与外观辅助设计：}使用 \textbf{Creo} 完成磁轴结构件与外观件的辅助设计，跟进从 3D 到样件的落地；针对装配干涉、卡键与手感一致性问题，通过调整配合间隙、导向面与限位结构逐版收敛。
    \item \textbf{工程图与结构图纸：}独立输出\textbf{微动开关与轴体结构的 CAD 工程图}，标注尺寸链、公差与关键配合，配套 BOM 与技术要求，供模具与产线直接使用。
    \item \textbf{轴体寿命与机械曲线测试：}搭建并执行轴体\textbf{寿命测试与机械曲线（力—位移）测试}，采集行程、触发力、段落感与回弹数据，输出\textbf{检测报告与技术文档}，把测试结论反哺到结构与材料选型上。
    \item \textbf{生产产线工艺改进：}参与产线工艺改进，梳理装配节拍与不良点，针对装配定位、来料一致性与工装适配提出改法。
\end{itemize}

% ===== 项目经历 =====
\mainsection{\faProjectDiagram}{项目经历}
\entryhead{四连杆两轮腿机器人（轮 + 足）}
  {结构设计 / 全部开发 · 轮足两用}
  {2026.01 -- 2026.09}
\tech{SolidWorks、连杆机构、不完全齿轮、丝杆传动、轻量化与加强筋、3D 打印、工程图机加工、URDF}
\begin{itemize}
    \item \textbf{整机结构设计：}完成大型四连杆轮腿机器人整体结构设计，实现\textbf{可轮可足}；足端做\textbf{可拆卸}设计，便于后期轮足切换；腿部做\textbf{轻量化 + 加强筋}处理，在保证刚度的前提下减重。
    \item \textbf{膝关节传动方案迭代：}前期采用\textbf{旋转转直动的丝杆驱动}，因响应不足改为\textbf{不完全齿轮配合连杆结构}，提升响应速度与机构紧凑度，并完成干涉校核与运动学验证。
    \item \textbf{建模与实物落地：}完成 URDF 制作与处理、STL 面片优化、碰撞模型简化、惯量计算；随后 3D 打印与工程图机加工，完成整机装配与调试。
\end{itemize}

\vspace{0em}
\entryhead{一种基于生态修复的水面垃圾打捞船}
  {压缩结构设计 · 独立负责}
  {2021.06 -- 2022.07}
\tech{SolidWorks、正弦机构原理、带传动 + 齿轮减速、钣金与机加工、导轨滑块、弹簧复位}
\begin{itemize}
    \item \textbf{压缩机构独立设计：}负责船体\textbf{压缩机构}设计 —— 直流电机经齿轮箱带动小带轮，带传动驱动大带轮；执行部分用\textbf{连杆 + 滑槽}组合，连杆随大带轮做周转运动、滑槽受其约束做直线运动，整体运动方式\textbf{类似正弦机构}。
    \item \textbf{压板导向与复位：}压板开\textbf{导轨与两销孔}，销在滑槽作用下带动压板完成压缩行程；下方布置\textbf{滑轨}，压板通过滑块连接，非工作时间由\textbf{弹簧力快速回正}；从零到有完成研发并\textbf{做出实物}。
\end{itemize}

\vspace{0em}
\entryhead{一种多足连杆机构的六足仿生蜘蛛}
  {运动原理设计 · 舵机数 18 → 6}
  {2022.11 -- 2023.02}
\tech{SolidWorks、余弦机构、绳驱、多杆机构、三角步态、自由度分析、样机装配调试}
\begin{itemize}
    \item \textbf{用机构换舵机：}传统六足机器人需 \textbf{18 个舵机}协同，本项目通过设计合理实用的机械结构，在\textbf{不牺牲六足自由度}的前提下把舵机数\textbf{减少到 6 个}，显著降本增效。
    \item \textbf{三大部分机构：}整机由\textbf{余弦机构、绳驱机构、多杆机构}组成，另配机械臂与摄像头；本人负责\textbf{余弦与绳驱的实现方案}，并以\textbf{“三角步态”}为设计目标完成运动原理设计，完成实物装配与调试。
\end{itemize}

\vspace{0em}
\entryhead{一种重型可调生物质能的新能源小车}
  {结构设计 · 独立完成转向机构}
  {2023.03 -- 2023.07}
\tech{SolidWorks、锥齿轮传动、齿轮箱传动链、滚筒拨片转向机构、温差发电、整车加工装配}
\begin{itemize}
    \item \textbf{整车结构主导设计：}设计一款模拟长征轨迹的重型可调新能源小车 —— 酒精燃烧的热能经\textbf{温差片}转化为电能驱动小车前进、转弯与磁片检测；主导\textbf{齿轮箱传动链、微调转向锥齿轮}等关键部件设计，保证复杂地形下的稳定性与灵活性。
    \item \textbf{独立发明转向机构：}独立设计\textbf{类滚筒拨片调整转向机构}，实现精确控制与自动循迹；独立完成整车加工与装配，从零到有做出实物。
\end{itemize}

% ===== 专业技能 =====
\mainsection{\faTools}{专业技能}
\begin{tabularx}{\linewidth}{@{}p{2.75cm}X@{}}
\skillrow{结构设计与建模}{SolidWorks / Creo / AutoCAD；自顶向下建模、装配体干涉检查、爆炸图与 BOM 输出}
\skillrow{机构设计}{连杆（正弦机构 / 四连杆）、不完全齿轮、凸轮、齿轮传动链、带传动、绳驱、导轨滑块}
\skillrow{工程图与工艺}{CAD 工程图（尺寸链、公差配合与关键配合标注）；3D 打印、CNC 机加工、钣金}
\skillrow{测试与验证}{寿命测试、力—位移（机械曲线）测试、运动学仿真；输出检测报告与技术文档}
\end{tabularx}

\mainsection{\faTrophy}{荣誉、证书与组织经历}
{\small
\renewcommand{\arraystretch}{0.84}
\begin{tabularx}{\linewidth}{@{}>{\raggedright\arraybackslash}X>{\raggedright\arraybackslash}X@{}}
{\bfseries\color{primary}研究生阶段}\quad\textcolor{accent}{\faTrophy}\enspace 学业奖学金一等奖（2024、2025） &
{\bfseries\color{primary}本科阶段}\quad\textcolor{accent}{\faTrophy}\enspace 湖南省机械创新设计大赛省二等奖\\
\textcolor{accent}{\faTrophy}\enspace 三维数字化创新设计大赛省一等奖 &
\textcolor{accent}{\faTrophy}\enspace 湖南省工程实训与创新能力大赛省三等奖\\
\textcolor{accent}{\faTrophy}\enspace 睿抗机器人开发者大赛国家二等奖 &
\textcolor{accent}{\faTrophy}\enspace 湖南省物联网设计大赛省一等奖\\
\textcolor{accent}{\faTrophy}\enspace 睿抗 ROS 机器人挑战赛省二等奖 &
\textcolor{accent}{\faTrophy}\enspace 国家级大创项目负责人\\
\textcolor{accent}{\faTrophy}\enspace 高校机器人创意大赛省二、三等奖 &
\textcolor{accent}{\faTrophy}\enspace 机械创新实验室负责人；智能制造协会会长\\
\textcolor{accent}{\faTrophy}\enspace 兼职辅导员（2024.09-2025.07） &
\textcolor{accent}{\faTrophy}\enspace CET-4、计算机二级、C1 驾照
\end{tabularx}}

\end{document}
```
