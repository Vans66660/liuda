# 留答

留答是一款以地点为交流载体的手机 App。上滑发现附近的留话，走近后解锁更多内容。在现场参与过的对话，离开后也能继续。

## 当前 App 原型

- **发现** · 地点卡片、收藏和当前地点名称。
- **留下** · 用手机定位确认现场，发布文字、现场照片或最长 30 秒的语音。
- **详情** · 简化地图显示自己、留言点、直线距离和手机朝向；道路覆盖取决于数据来源。
- **个人中心** · 本机昵称、头像、留话、对话与收藏。

部分内置卡片使用演示地点。当前记录保存在本机，账号登录、跨设备同步和真实赏金支付仍待接入。

## 快速启动

App 源码位于 `feature/app-profile` 分支的 `mobile/` 目录。获得仓库访问权限并安装 Git 和 Node.js 24 后运行：

```sh
git clone --branch feature/app-profile https://github.com/Vans66660/liuda.git
cd liuda/mobile
npm ci
npx expo start --go
```

用兼容 Expo SDK 58 的 Expo Go 扫描终端二维码。电脑与手机连接同一 Wi‑Fi。也可以在电脑上运行 `npm run web` 预览界面。

[App 开发与真机验证](mobile/README.md) · [协作指南](CONTRIBUTING.md)

## 历史原型

[微信小程序归档](MINIPROGRAM.md)保留初代代码的运行与部署背景。
