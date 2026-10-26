---
contents:
  - id: 170
    label: testpy
    language: python
createdAt: 1791606042982
description: "基于jupyter类型的段运行测试示例"
folderId: 31
id: 114
isDeleted: 0
isFavorites: 0
name: testpy
updatedAt: 1791606042982
tags:
  - 34
  - 35
---

## Fragment: testpy
```python
# %% 1. 基本计算（光标放这，按 Ctrl/⌘+Alt+Enter 只跑本格）
a = 3
b = 4
print("a + b =", a + b)


# %%




# %% 2. 变量还在吗？★ 这是 Jupyter 式内核的核心
# Python 走的是**持久内核**，变量跨格保留
# 所以这里直接「▶ 本段」就能用上一格的 a、b（不用「跑到这里」）
print("a * b =", a * b)
x = [i * i for i in range(6)]
print("x =", x)

# %% 3. import 的模块也会保留
import math
print("pi =", math.pi)

# %% 4. 下一格直接用 math，不用重新 import ★
print("round(pi, 3) =", round(math.pi, 3))

# %% 5. 自定义函数也保留
def sq(n):
    return n * n

print("sq(7) =", sq(7))

# %% 6. 下一格还能用 sq ★（多行函数定义也不怕）
print("前 5 个平方和 =", sum(sq(i) for i in range(1, 6)))

# %% 7. 故意报错（验证报错显示，且内核不会死）
print(1 / 0)

# %% 8. 报错之后内核还活着 ★
print("内核还活着，a * 10 =", a * 10)
```
