# 参与留答 App 开发

按 [App 开发说明](mobile/README.md) 启动手机预览。App 开发以 `feature/app-profile` 为基线，源码在 `mobile/`。日常任务从最新 App 分支创建专题分支，Pull Request 选择 App 分支作为目标。

| 工作 | 代码目录 |
| --- | --- |
| 页面与交互 | `mobile/src/app`、`mobile/src/components` |
| 定位与地点解析 | `mobile/src/location`、`mobile/src/app/api` |
| 本机记录与用户资料 | `mobile/src/state` |

在 `mobile/` 运行 `npm run typecheck` 和 `npm run lint`。界面改动附截图或短录屏，涉及定位、相机和麦克风时注明设备、使用的预览环境和实测结果。提交前检查暂存文件，地图密钥、个人环境配置及真实用户位置留在仓库之外。

初代微信开发者工具、云函数及数据库说明见 [微信小程序归档](MINIPROGRAM.md)。
