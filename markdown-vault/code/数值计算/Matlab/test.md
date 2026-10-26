---
contents:
  - id: 169
    label: test
    language: matlab
createdAt: 1791605870994
description: "基于matlab/octave的数值计算运行示例"
folderId: 31
id: 113
isDeleted: 0
isFavorites: 0
name: test
updatedAt: 1791605870994
tags:
  - 33
  - 36
---

## Fragment: test
```matlab
%% 1. 基本计算（光标放这，按 Ctrl/⌘+Alt+Enter 只跑本段）
a = 3;
b = 4;
fprintf("a + b = %d\n", a + b);

%% 2. 用上一段的变量（这里要用「▶▶ 跑到这里」）
% 「▶ 本段」会报 a undefined —— 段运行是每次新进程，不保留变量
% 「▶▶ 跑到这里」会先把第 1 段跑一遍，所以 a、b 都在
fprintf("a * b = %d\n", a * b);
x = 1:5;
fprintf("x 的平方: ");
disp(x .^ 2);

%% 3. 矩阵与转置（注意 A' 是转置，不是字符串）
A = [1 2; 3 4];
fprintf("det(A) = %d\n", det(A));
disp("A 的转置:");
disp(A');

%% 4. 匿名函数 + 循环
sq = @(n) n * n;
s = 0;
for k = 1:5
  s = s + sq(k);
end
fprintf("1^2+2^2+...+5^2 = %d\n", s);

%% 5. 正弦函数（Octave 无界面模式只算不画）
t = linspace(0, 2*pi, 200);
y = sin(t);
fprintf("sin 最大值 = %.4f，最小值 = %.4f\n", max(y), min(y));

%% 6. 故意报错（验证报错能正常显示）
error("这是我故意抛的错误，用来验证报错显示");
%% 7. 画图（Octave 无界面也能画 ✓ 跑完图会直接显示在输出区 ✓）
x = linspace(0, 2*pi, 200);
figure("visible", "off");
plot(x, sin(x), "b-", "LineWidth", 2);
hold on; plot(x, cos(x), "r--", "LineWidth", 2); hold off;
title("sin 与 cos"); xlabel("x"); ylabel("y"); legend("sin", "cos"); grid on;
print("-dpng", "-r120", "sine_cos.png");
disp("已生成 sine_cos.png —— 看输出区下面的图 ✓");
% ★ 应用会自动再导出一份 fig1.fig ✓（可编辑的图形文件 ✓）
%   在输出区点「⬇ 下载（可编辑）」，然后用 Octave / MATLAB 打开就能继续改 ✓
%   也可以在本项目底部终端里： octave --no-gui  然后  openfig("fig1.fig")  ✓

%% 8. 组合运行说明（选中多段一起跑 ✓）
% 想「段与段组合运行」：用鼠标选中若干段（可以跨段），再按 Ctrl/⌘+Alt+Enter
% 就会只跑你选中的那部分 —— 这就是段与段的组合运行 ✓
```
