---
contents:
  - id: 1
    label: main.cpp
    language: c_cpp
  - id: 2
    label: README.md
    language: markdown
  - id: 3
    label: config.hpp
    language: c_cpp
  - id: 4
    label: types.hpp
    language: c_cpp
  - id: 5
    label: calc.hpp
    language: c_cpp
  - id: 6
    label: math_utils.hpp
    language: c_cpp
  - id: 7
    label: bit_ops.hpp
    language: c_cpp
  - id: 8
    label: sort.hpp
    language: c_cpp
  - id: 9
    label: search.hpp
    language: c_cpp
  - id: 10
    label: array_utils.hpp
    language: c_cpp
  - id: 11
    label: stats.hpp
    language: c_cpp
  - id: 12
    label: string_utils.hpp
    language: c_cpp
  - id: 13
    label: matrix.hpp
    language: c_cpp
  - id: 14
    label: list.hpp
    language: c_cpp
  - id: 15
    label: tree.hpp
    language: c_cpp
  - id: 16
    label: dp.hpp
    language: c_cpp
  - id: 17
    label: random_utils.hpp
    language: c_cpp
  - id: 18
    label: timer.hpp
    language: c_cpp
  - id: 19
    label: logger.hpp
    language: c_cpp
  - id: 20
    label: error.hpp
    language: c_cpp
createdAt: 1787912000000
description: 多文件编译示例：20 个分片（main.cpp + 19 个头文件 / README），一起编译运行
folderId: 4
id: 10
isDeleted: 0
isFavorites: 0
name: 多文件示例_CPP
tags:
  - 1
updatedAt: 1792403869951
---

## Fragment: main.cpp
```c_cpp
// 入口：把各个头文件里的示例串起来跑一遍
#include "config.hpp"
#include "types.hpp"
#include "calc.hpp"
#include "math_utils.hpp"
#include "bit_ops.hpp"
#include "sort.hpp"
#include "search.hpp"
#include "array_utils.hpp"
#include "stats.hpp"
#include "string_utils.hpp"
#include "matrix.hpp"
#include "list.hpp"
#include "tree.hpp"
#include "dp.hpp"
#include "random_utils.hpp"
#include "timer.hpp"
#include "logger.hpp"
#include "error.hpp"

#include <iostream>
using namespace std;

int main() {
  logInfo("demo start, version " + string(config::kVersion));

  types::Point p{3, 4};
  cout << "point(" << p.x << "," << p.y << ")" << endl;
  cout << "add(2,3) = " << calc::add(2, 3) << endl;
  cout << "gcd(24,18) = " << math::gcd(24, 18) << endl;
  cout << "isPrime(97) = " << math::isPrime(97) << endl;
  cout << "popcount(0b10110110) = " << bits::popcount(0b10110110) << endl;

  int a[] = {5, 2, 9, 1, 6};
  int n = sizeof(a) / sizeof(a[0]);
  sortx::insertion(a, n);
  cout << "sorted: ";
  for (int i = 0; i < n; ++i) cout << a[i] << ' ';
  cout << endl;
  cout << "index of 6 = " << searchx::binary(a, n, 6) << endl;

  cout << "sum = " << arr::sum(a, n) << " max = " << arr::maxOf(a, n) << endl;
  cout << "mean = " << stats::mean(a, n) << endl;

  cout << "trim(  hi  ) = [" << strx::trim("  hi  ") << "]" << endl;

  matrix::Mat m = matrix::identity();
  matrix::print(m);

  auto xs = listx::build({1, 2, 3});
  listx::print(listx::reverse(xs));

  treex::Node* root = treex::buildSample();
  cout << "preorder: ";
  treex::preOrder(root);
  cout << endl;

  cout << "fib(20) = " << dp::fib(20) << " knapsack = " << dp::knapsack() << endl;

  auto data = rnd::array(5, 7);
  cout << "random: ";
  for (int x : data) cout << x << ' ';
  cout << endl;

  timer::Scope t("sum loop");
  long long s = 0;
  for (int i = 0; i < 100000; ++i) s += i;
  cout << "loop sum = " << s << endl;

  try { errorx::checkDivisor(0); }
  catch (const std::exception& e) { logWarn(string("caught: ") + e.what()); }

  logInfo("demo done");
  return 0;
}
```

## Fragment: README.md
```markdown
# 多文件示例（20 个分片）

一个"头文件库 + 单入口"的小工程，用来演示 **一个片段里放很多分片** 的用法。

## 分层

| 层 | 分片 |
|---|---|
| 入口 | `main.cpp` |
| 配置 / 类型 | `config.hpp` `types.hpp` |
| 基础工具 | `calc.hpp` `math_utils.hpp` `bit_ops.hpp` `array_utils.hpp` `stats.hpp` `string_utils.hpp` |
| 算法 | `sort.hpp` `search.hpp` `dp.hpp` |
| 数据结构 | `list.hpp` `tree.hpp` `matrix.hpp` |
| 运行时 | `random_utils.hpp` `timer.hpp` `logger.hpp` `error.hpp` |

## 为什么全是头文件

所有函数都写了 `inline`，所以 19 个头 + 1 个 main **作为同一个编译单元**就能编过，
不需要额外的 `.cpp`、也不会撞重复定义 —— 这样"一起编译运行"这个按钮才点得通。

## 改法

- 想加新功能：新建一个 `xxx.hpp`，函数写 `inline`，在 `main.cpp` 里 include 即可；
- 分片标签名就是文件名，改标签等于改文件名（IDE 里点标签右键可重命名）。
```

## Fragment: config.hpp
```c_cpp
#ifndef CONFIG_HPP
#define CONFIG_HPP

namespace config {
inline constexpr const char* kVersion = "1.0.0";
inline constexpr int kMatrixSize = 3;
inline constexpr int kRandomSeed = 42;
}

#endif
```

## Fragment: types.hpp
```c_cpp
#ifndef TYPES_HPP
#define TYPES_HPP

#include <string>

namespace types {
struct Point { int x; int y; };
struct Range { int lo; int hi; };
struct Person { std::string name; int age; };
}

#endif
```

## Fragment: calc.hpp
```c_cpp
#ifndef CALC_HPP
#define CALC_HPP

namespace calc {
inline int add(int a, int b) { return a + b; }
inline int sub(int a, int b) { return a - b; }
inline int mul(int a, int b) { return a * b; }
inline double div(double a, double b) { return b == 0 ? 0 : a / b; }
}

#endif
```

## Fragment: math_utils.hpp
```c_cpp
#ifndef MATH_UTILS_HPP
#define MATH_UTILS_HPP

namespace math {
inline int gcd(int a, int b) { while (b) { int t = a % b; a = b; b = t; } return a; }
inline int lcm(int a, int b) { return a / gcd(a, b) * b; }
inline bool isPrime(int n) {
  if (n < 2) return false;
  for (int i = 2; 1LL * i * i <= n; ++i) if (n % i == 0) return false;
  return true;
}
inline int abs(int v) { return v < 0 ? -v : v; }
}

#endif
```

## Fragment: bit_ops.hpp
```c_cpp
#ifndef BIT_OPS_HPP
#define BIT_OPS_HPP

namespace bits {
inline bool isPow2(unsigned x) { return x && !(x & (x - 1)); }
inline int popcount(unsigned x) { int c = 0; while (x) { x &= x - 1; ++c; } return c; }
inline unsigned lowbit(unsigned x) { return x & (~x + 1u); }
inline void swapXor(int& a, int& b) { a ^= b; b ^= a; a ^= b; }
}

#endif
```

## Fragment: sort.hpp
```c_cpp
#ifndef SORT_HPP
#define SORT_HPP

namespace sortx {
inline void bubble(int a[], int n) {
  for (int i = 0; i < n - 1; ++i)
    for (int j = 0; j < n - 1 - i; ++j)
      if (a[j] > a[j + 1]) { int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }
}
inline void insertion(int a[], int n) {
  for (int i = 1; i < n; ++i) {
    int key = a[i], j = i - 1;
    while (j >= 0 && a[j] > key) { a[j + 1] = a[j]; --j; }
    a[j + 1] = key;
  }
}
}

#endif
```

## Fragment: search.hpp
```c_cpp
#ifndef SEARCH_HPP
#define SEARCH_HPP

namespace searchx {
inline int binary(const int a[], int n, int key) {
  int lo = 0, hi = n - 1;
  while (lo <= hi) {
    int mid = lo + (hi - lo) / 2;
    if (a[mid] == key) return mid;
    if (a[mid] < key) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
inline int linear(const int a[], int n, int key) {
  for (int i = 0; i < n; ++i) if (a[i] == key) return i;
  return -1;
}
}

#endif
```

## Fragment: array_utils.hpp
```c_cpp
#ifndef ARRAY_UTILS_HPP
#define ARRAY_UTILS_HPP

namespace arr {
inline long long sum(const int a[], int n) { long long s = 0; for (int i = 0; i < n; ++i) s += a[i]; return s; }
inline int maxOf(const int a[], int n) { int m = a[0]; for (int i = 1; i < n; ++i) if (a[i] > m) m = a[i]; return m; }
inline int minOf(const int a[], int n) { int m = a[0]; for (int i = 1; i < n; ++i) if (a[i] < m) m = a[i]; return m; }
inline void reverse(int a[], int n) {
  for (int i = 0, j = n - 1; i < j; ++i, --j) { int t = a[i]; a[i] = a[j]; a[j] = t; }
}
}

#endif
```

## Fragment: stats.hpp
```c_cpp
#ifndef STATS_HPP
#define STATS_HPP

namespace stats {
inline double mean(const int a[], int n) {
  if (n <= 0) return 0;
  long long s = 0;
  for (int i = 0; i < n; ++i) s += a[i];
  return double(s) / n;
}
inline int median(int a[], int n) {
  if (n <= 0) return 0;
  for (int i = 1; i < n; ++i) {
    int key = a[i], j = i - 1;
    while (j >= 0 && a[j] > key) { a[j + 1] = a[j]; --j; }
    a[j + 1] = key;
  }
  return n % 2 ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
}

#endif
```

## Fragment: string_utils.hpp
```c_cpp
#ifndef STRING_UTILS_HPP
#define STRING_UTILS_HPP

#include <string>
#include <vector>

namespace strx {
inline std::string trim(const std::string& s) {
  size_t b = s.find_first_not_of(" \t\r\n");
  if (b == std::string::npos) return "";
  size_t e = s.find_last_not_of(" \t\r\n");
  return s.substr(b, e - b + 1);
}
inline std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> out;
  std::string cur;
  for (char c : s) { if (c == sep) { out.push_back(cur); cur.clear(); } else cur += c; }
  out.push_back(cur);
  return out;
}
inline std::string upper(std::string s) {
  for (char& c : s) if (c >= 'a' && c <= 'z') c = char(c - 'a' + 'A');
  return s;
}
}

#endif
```

## Fragment: matrix.hpp
```c_cpp
#ifndef MATRIX_HPP
#define MATRIX_HPP

#include <iostream>

namespace matrix {
struct Mat { int m[3][3]; };

inline Mat identity() {
  Mat r{};
  for (int i = 0; i < 3; ++i) r.m[i][i] = 1;
  return r;
}
inline Mat mul(const Mat& a, const Mat& b) {
  Mat c{};
  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j)
      for (int k = 0; k < 3; ++k) c.m[i][j] += a.m[i][k] * b.m[k][j];
  return c;
}
inline void print(const Mat& x) {
  for (int i = 0; i < 3; ++i) {
    for (int j = 0; j < 3; ++j) std::cout << x.m[i][j] << ' ';
    std::cout << std::endl;
  }
}
}

#endif
```

## Fragment: list.hpp
```c_cpp
#ifndef LIST_HPP
#define LIST_HPP

#include <initializer_list>
#include <iostream>

namespace listx {
struct Node { int v; Node* next; };

inline Node* build(std::initializer_list<int> xs) {
  Node* head = nullptr;
  Node** tail = &head;
  for (int x : xs) { *tail = new Node{x, nullptr}; tail = &(*tail)->next; }
  return head;
}
inline Node* reverse(Node* h) {
  Node* prev = nullptr;
  while (h) { Node* nx = h->next; h->next = prev; prev = h; h = nx; }
  return prev;
}
inline void print(Node* h) {
  for (; h; h = h->next) std::cout << h->v << ' ';
  std::cout << std::endl;
}
}

#endif
```

## Fragment: tree.hpp
```c_cpp
#ifndef TREE_HPP
#define TREE_HPP

#include <iostream>

namespace treex {
struct Node { int v; Node* l; Node* r; };

inline Node* buildSample() {
  return new Node{1,
    new Node{2, new Node{4, nullptr, nullptr}, new Node{5, nullptr, nullptr}},
    new Node{3, nullptr, new Node{6, nullptr, nullptr}}};
}
inline void preOrder(Node* n) { if (!n) return; std::cout << n->v << ' '; preOrder(n->l); preOrder(n->r); }
inline void inOrder(Node* n) { if (!n) return; inOrder(n->l); std::cout << n->v << ' '; inOrder(n->r); }
inline int depth(Node* n) {
  if (!n) return 0;
  int a = depth(n->l), b = depth(n->r);
  return 1 + (a > b ? a : b);
}
}

#endif
```

## Fragment: dp.hpp
```c_cpp
#ifndef DP_HPP
#define DP_HPP

#include <vector>
#include <algorithm>

namespace dp {
inline long long fib(int n) {
  if (n < 2) return n;
  long long a = 0, b = 1;
  for (int i = 2; i <= n; ++i) { long long c = a + b; a = b; b = c; }
  return b;
}
inline int knapsack() {
  const int w[] = {2, 3, 4, 5}, v[] = {3, 4, 5, 8};
  const int cap = 8;
  std::vector<int> f(cap + 1, 0);
  for (int i = 0; i < 4; ++i)
    for (int c = cap; c >= w[i]; --c)
      f[c] = std::max(f[c], f[c - w[i]] + v[i]);
  return f[cap];
}
}

#endif
```

## Fragment: random_utils.hpp
```c_cpp
#ifndef RANDOM_UTILS_HPP
#define RANDOM_UTILS_HPP

#include <random>
#include <vector>

namespace rnd {
inline std::vector<int> array(int n, unsigned seed) {
  std::mt19937 rng(seed);
  std::uniform_int_distribution<int> dist(1, 100);
  std::vector<int> out(n);
  for (auto& x : out) x = dist(rng);
  return out;
}
}

#endif
```

## Fragment: timer.hpp
```c_cpp
#ifndef TIMER_HPP
#define TIMER_HPP

#include <chrono>
#include <iostream>
#include <string>

namespace timer {
struct Scope {
  std::string label;
  std::chrono::steady_clock::time_point t0;
  explicit Scope(std::string name) : label(std::move(name)), t0(std::chrono::steady_clock::now()) {}
  ~Scope() {
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now() - t0).count();
    std::cout << "[timer] " << label << " took " << ms << "ms" << std::endl;
  }
};
}

#endif
```

## Fragment: logger.hpp
```c_cpp
#ifndef LOGGER_HPP
#define LOGGER_HPP

#include <iostream>
#include <string>

namespace {
inline void logInfo(const std::string& s) { std::cout << "[INFO] " << s << std::endl; }
inline void logWarn(const std::string& s) { std::cout << "[WARN] " << s << std::endl; }
inline void logError(const std::string& s) { std::cerr << "[ERR ] " << s << std::endl; }
}

#endif
```

## Fragment: error.hpp
```c_cpp
#ifndef ERROR_HPP
#define ERROR_HPP

#include <stdexcept>

namespace errorx {
inline void checkDivisor(double b) {
  if (b == 0) throw std::invalid_argument("divisor is zero");
}
inline int at(const int a[], int n, int i) {
  if (i < 0 || i >= n) throw std::out_of_range("index out of range");
  return a[i];
}
}

#endif
```
