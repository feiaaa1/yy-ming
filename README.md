# Ming Cutout

浏览器内的图片抠图与多轮调整工作台，使用 OpenRouter `inclusionai/ming-image-0.1-design-layer`。

## 运行

```bash
npm ci
npm run dev
```

填写自己的 OpenRouter API Key，可一次选择或拖入多张 PNG、JPG、WebP 图片。在批量要求中填写“全部抠成白底图”等指令，点击“开始批量抠图”；每张图片会成为独立任务，最多同时处理 3 个，其余排队。每项任务都会保存透明抠图和白底成品，也可以继续逐张调整。请保持页面打开直到请求完成。

任务和图片保存在当前浏览器的 IndexedDB，API Key 保存在 `localStorage`。请求由浏览器直接发送至 OpenRouter。批次完成后可单独下载全部白底成品；下载完整批次或全部任务会导出原图、每轮所有图片以及对话记录 JSON。页面刷新会中断正在进行的请求，可以在任务详情中重试。

模型每次只接受一张参考图，返回的是分解后的 RGBA 图片。抠图效果取决于模型输出，复杂边缘建议通过后续对话继续调整。
