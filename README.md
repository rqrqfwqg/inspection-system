# 用户管理系统

一个现代化的用户管理后台系统，基于 React + TypeScript + Vite + Tailwind CSS + shadcn/ui 构建。

## 功能特性

- ✅ **登录页面** - 支持邮箱密码登录，带有加载动画
- ✅ **数据看板** - 展示用户统计、增长趋势图表、角色分布
- ✅ **用户列表管理** - 支持搜索、筛选、分页
- ✅ **表单编辑** - 新增/编辑用户信息，支持角色和状态管理
- ✅ **响应式布局** - 完美适配桌面端和移动端

## 技术栈

- **框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **样式**: Tailwind CSS 3.4
- **UI 组件**: shadcn/ui + Radix UI
- **图表**: Recharts
- **图标**: Lucide React
- **路由**: React Router 6
- **状态管理**: React Context

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

### 3. 构建生产版本

```bash
npm run build
```

## 项目结构

```
src/
├── components/          # 组件目录
│   ├── layout/         # 布局组件
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── MainLayout.tsx
│   ├── ui/             # UI 基础组件
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── table.tsx
│   │   └── ...
│   └── users/          # 用户相关组件
│       └── UserFormDialog.tsx
├── contexts/           # React Context
│   └── AuthContext.tsx
├── data/               # 模拟数据
│   └── mockData.ts
├── hooks/              # 自定义 Hooks
│   └── use-toast.ts
├── lib/                # 工具函数
│   └── utils.ts
├── pages/              # 页面组件
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── UsersPage.tsx
│   └── SettingsPage.tsx
├── types/              # TypeScript 类型定义
│   └── index.ts
├── App.tsx             # 应用主组件
├── main.tsx            # 入口文件
└── index.css           # 全局样式
```

## 主要页面

### 1. 登录页面 (`/login`)
- 现代化登录界面设计
- 表单验证
- 加载动画
- 演示账号：任意邮箱和密码即可登录

### 2. 数据看板 (`/dashboard`)
- 四个统计卡片：总用户数、活跃用户、今日新增、待审核用户
- 用户增长趋势折线图
- 用户角色分布统计
- 最近活动列表

### 3. 用户管理 (`/users`)
- 用户列表表格
- 搜索功能
- 添加新用户
- 编辑用户信息
- 删除用户
- 角色和状态筛选

### 4. 系统设置 (`/settings`)
- 账户信息编辑
- 安全设置（密码修改）
- 通知偏好设置

## 响应式设计

系统完全支持响应式布局：

- **桌面端** (≥1024px): 完整侧边栏 + 主内容区
- **平板端** (768px-1023px): 可折叠侧边栏
- **移动端** (<768px): 汉堡菜单 + 抽屉式侧边栏

## 演示说明

1. 在登录页面输入任意邮箱和密码即可登录
2. 登录后自动跳转到数据看板
3. 可以查看用户列表、添加/编辑/删除用户
4. 所有操作都有 Toast 提示反馈

## 开发说明

- 使用 TypeScript 确保类型安全
- 使用 React Context 管理登录状态
- 使用 localStorage 持久化登录状态
- shadcn/ui 组件提供了一致的设计语言
- Tailwind CSS 实现快速样式开发

## 浏览器支持

- Chrome (推荐)
- Firefox
- Safari
- Edge
