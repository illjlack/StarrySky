# StarrySky

一幅随浏览器本地时间变化的油画场景，以及两只由 JSON 动作清单驱动的桌面宠物。
(One day, I asked ChatGPT to build it. The rest is history.)

## 在线效果

**[打开 liuhuan.help 体验 StarrySky →](https://liuhuan.help/)**

[![StarrySky 在线效果](./docs/starrysky-preview.png)](https://liuhuan.help/)

## 组成

- `ambient-scene`：晨、昼、暮、夜切换，太阳轨迹、月相、云、树、草与轻微视差。
- `pet-world`：读取宠物 JSON 与 spritesheet，支持自动待机、随机动作、短距离游走、点击互动和拖动落地。
- `service-drawer`：默认收起的服务与连接入口。
- 原生 Web Components、CSS 与 Canvas，无前端框架和运行时依赖。

## 本地预览

请通过 HTTP 服务打开，避免浏览器对 ES Modules 和本地资源的限制：

```bash
python -m http.server 8080
```

然后访问 `http://127.0.0.1:8080/`。

## 宠物动作

动作、帧序列、循环方式、随机权重和左右移动绑定均位于：

- `assets/pets/noirrose/pet.json`
- `assets/pets/miemieyan/pet.json`

页面中的宠物单击后随机播放一个非移动动作；拖动超过阈值时只移动和落地，不触发点击动作。

## 使用与授权

除宠物 OC 元素外，本仓库的代码、页面与其他美术资源采用 [MIT License](./LICENSE)，允许使用、复制、修改、发布、分发、再许可及商业使用。

### 朋友的 OC

NoirRose 与 MieMieYan 是朋友创作的原创角色（OC），相关权利归各自的 OC 原作者所有。以下目录中的角色形象、名称、spritesheet、动画、动作配置及其衍生元素均不属于 MIT 开放范围：

- `assets/pets/noirrose/**`（NoirRose）
- `assets/pets/miemieyan/**`（MieMieYan）

这些 OC 元素出现在仓库和线上页面中，仅用于展示本项目效果，不代表向访问者或仓库使用者授予任何许可。

**未经对应 OC 原作者明确允许，不得以任何形式使用这两个宠物 OC 及其相关元素，无论用途是商业还是非商业。** 包括但不限于复制、提取、修改、再发布、加入其他项目、制作衍生作品或用于模型训练。

如需使用或分发仓库中采用 MIT License 的部分，请先移除上述两个宠物目录及所有相关 OC 元素。

完整说明见 [宠物 OC 权利说明](./assets/pets/LICENSE.md)。
