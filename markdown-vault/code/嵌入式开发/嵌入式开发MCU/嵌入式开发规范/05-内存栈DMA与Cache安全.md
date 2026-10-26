---
contents:
  - id: 32
    label: 内存DMA安全.md
    language: markdown
createdAt: 1788171531000
description: 规范内存所有权、栈、缓冲区、DMA、D-Cache和环形缓冲区。
folderId: 12
id: 31
isDeleted: 0
isFavorites: 0
name: 05-内存栈DMA与Cache安全
tags:
  - 4
  - 10
  - 19
  - 20
updatedAt: 1788172784000
---

## Fragment: 内存DMA安全.md
````markdown
# 内存、栈、DMA 与 Cache 安全

## 1. 所有权

每个动态对象或缓冲区必须能回答：

- 由谁创建？
- 由谁释放？
- 是否可以跨线程传递？
- 传递是复制、借用还是移交所有权？
- 有效期到什么时候？
- 错误路径由谁清理？

不得返回局部变量地址，不得在对象释放后保留回调或 DMA 引用。

## 2. 分配和清理

- 分配后立即检查结果。
- 同一对象必须使用配对的 allocator/free 家族。
- 多步初始化使用单一清理路径，按获取的逆序释放。
- 释放后如果指针仍在作用域内，将其设为 `NULL`。
- 实时任务和 ISR 不进行无界动态分配。
- 重复运行的工作缓冲区优先启动期预分配。

## 3. 栈规则

- 禁止 VLA 和 `alloca`。
- 默认禁止递归；确有需求时必须证明最大深度。
- 大数组、图像、协议帧和文件缓冲区不放在任务栈上。
- 对每个任务测量栈高水位，覆盖最大负载、错误路径和嵌套回调。
- 发布版保留栈溢出检测或哨兵机制。
- 线程属性使用静态内存时，TCB 和 stack 必须符合当前 RTOS 封装的成对要求。

## 4. 缓冲区安全

- 指针与容量始终成对。
- 区分容量、已用长度和终止符空间。
- 计算 `count * element_size` 前检查整数溢出。
- 外部长度、帧头长度和索引全部进行边界检查。
- 文本格式化使用 `snprintf`，并检查截断。
- 重叠内存区域使用 `memmove`，不使用 `memcpy`。

## 5. DMA 一致性

DMA 缓冲区必须同时满足：

- DMA 可访问的内存区域。
- 控制器要求的对齐和传输宽度。
- DMA 工作期间对象不被释放或移动。
- CPU 和 DMA 之间的所有权切换明确。

存在 D-Cache 时：

| 方向 | 启动 DMA 前 | DMA 完成后 |
| --- | --- | --- |
| CPU → DMA（TX） | Clean 相关 cache line | 通常无需操作 |
| DMA → CPU（RX） | 按平台要求预处理 | CPU 读取前 Invalidate |

Cache 操作的地址和长度必须按 cache line 边界扩展。如果使用 MPU 非缓存区，必须在链接脚本和内存布局文档中固定。

## 6. UART DMA + Ring Buffer 基线

```text
UART → DMA Circular Buffer → Ring Buffer → 读取任务
             ↓ Idle/HT/FT IRQ
             ↓ 极简通知
```

- 分离生产者写索引和消费者读索引。
- 明确 full/empty 判定和溢出策略：丢旧、丢新或报错。
- ISR 只更新必要索引并通知任务，不解析数据。
- 帧错误、溢出、DMA 错误后停止、清状态并重启接收。
- 压力测试覆盖持续满速、非定长帧、任务暂停和索引回绕。
````
