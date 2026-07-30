# StarrySky

[liuhuan.help](https://liuhuan.help/) 的动态个人主页：一幅随浏览器本地时间变化的油画场景，以及两只由 JSON 动作清单驱动的桌面宠物。

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

## 权利

本仓库未附开源许可证。除非获得仓库所有者的明确书面授权，不授予复制、再发布、衍生或商业使用代码、美术与宠物资产的权利。
