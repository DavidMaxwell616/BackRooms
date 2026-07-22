import MainScene from "./MainScene.js";

new Phaser.Game({
    type: Phaser.AUTO,
    backgroundColor: '#0b0f14',
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: window.innerWidth,
        height: window.innerHeight
    },
    scene: [MainScene],
    fps: { target: 60, forceSetTimeOut: true }
});
