export function makeWhiteBackground(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('无法合成白底图片。'));
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法创建画布。');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), mime: 'image/png', extension: 'png', kind: 'white' });
      } catch (error) { reject(error); }
    };
    image.src = dataUrl;
  });
}
