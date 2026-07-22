import { ChunkedMap } from "./ChunkedMap.js";
import { Raycaster } from "./Raycaster.js";

export default class MainScene extends Phaser.Scene {
    preload() {
        this.load.image('wall', 'assets/wall-v2.png');
        this.load.image('floor', 'assets/floor-v2.png');
        this.load.image('ceiling', 'assets/ceiling-v2.png');
        this.load.image('entity', 'assets/entity.png');
        this.load.image('officeFurniture', 'assets/office-furniture.png');
        this.load.image('labWorkstation', 'assets/lab-workstation.png');
    }

    create() {
        this.map = new ChunkedMap({ chunkSize: 24, keepRadius: 3, seed: 1337 });

        this.posX = 12.5;
        this.posY = 12.5;
        this.dirX = 0;
        this.dirY = 1;
        this.planeX = 0.66;
        this.planeY = 0;
        this.pitch = 0;
        this.entity = {
            x: this.posX + 6,
            y: this.posY + 10,
            speed: 0.55,     // slow creep
            active: true
        };

        this.keys = this.input.keyboard.addKeys('W,A,S,D,SHIFT');
        this.input.on('pointerdown', () => this.input.mouse.requestPointerLock());
        this.input.mouse.disableContextMenu();

        this.input.on('pointermove', (p) => {
            if (!this.input.mouse.locked) return;
            const sens = 0.0022;
            const dx = p.movementX;
            const dy = p.movementY;

            const rot = -dx * sens;
            const oldDirX = this.dirX;
            this.dirX = this.dirX * Math.cos(rot) - this.dirY * Math.sin(rot);
            this.dirY = oldDirX * Math.sin(rot) + this.dirY * Math.cos(rot);

            const oldPlaneX = this.planeX;
            this.planeX = this.planeX * Math.cos(rot) - this.planeY * Math.sin(rot);
            this.planeY = oldPlaneX * Math.sin(rot) + this.planeY * Math.cos(rot);

            this.pitch = Phaser.Math.Clamp(this.pitch - dy * 0.25, -120, 120);
        });

        const vw = 360, vh = 220;
        const wallImg = this.textures.get('wall').getSourceImage();
        const floorImg = this.textures.get('floor').getSourceImage();
        const ceilImg = this.textures.get('ceiling').getSourceImage();

        this.ray = new Raycaster(
            this,
            vw, vh,
            { wall: wallImg, floor: floorImg, ceil: ceilImg },
            (ix, iy) => this.map.getCell(ix, iy),
            (wx, wy, margin = 0) => this.map.isInLargeRoom(wx, wy, margin)
        );

        this.ray.resizeToScreen();
        this.scale.on('resize', () => this.ray.resizeToScreen());

        this.light = 1.0;
        this.nextFlicker = 0;
        const entImg = this.textures.get('entity').getSourceImage();
        const c = document.createElement('canvas');
        c.width = entImg.width; c.height = entImg.height;
        const cx = c.getContext('2d');
        cx.drawImage(entImg, 0, 0);
        const id = cx.getImageData(0, 0, entImg.width, entImg.height);

        this.ray.entityPx = id.data;
        this.ray.entityW = entImg.width;
        this.ray.entityH = entImg.height;
        this.ray.decorationSprites = {
            office: this.readTexturePixels('officeFurniture'),
            lab: this.readTexturePixels('labWorkstation')
        };
        this.props = this.map.getDecorationsAround(this.posX, this.posY);

        this.createMinimap();

    }

    readTexturePixels(textureKey) {
        const image = this.textures.get(textureKey).getSourceImage();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return {
            px: context.getImageData(0, 0, image.width, image.height).data,
            w: image.width,
            h: image.height
        };
    }

    createMinimap() {
        this.minimap = this.add.graphics().setDepth(1000).setScrollFactor(0);
        this.minimapRadius = 10;
        this.minimapCellSize = 6;
    }

    drawMinimap() {
        const graphics = this.minimap;
        const radius = this.minimapRadius;
        const cellSize = this.minimapCellSize;
        const size = radius * 2 * cellSize;
        const left = this.scale.width - size - 16;
        const top = 16;
        const centerX = left + size / 2;
        const centerY = top + size / 2;
        const startX = Math.floor(this.posX - radius);
        const endX = Math.ceil(this.posX + radius);
        const startY = Math.floor(this.posY - radius);
        const endY = Math.ceil(this.posY + radius);

        graphics.clear();
        graphics.fillStyle(0x080b0d, 0.82);
        graphics.fillRect(left, top, size, size);

        // Keep the map fixed to the world while the player remains centered.
        graphics.fillStyle(0xc2b77a, 0.82);
        for (let worldY = startY; worldY < endY; worldY++) {
            for (let worldX = startX; worldX < endX; worldX++) {
                if (!this.map.getCell(worldX, worldY)) continue;

                const x = centerX + (worldX - this.posX) * cellSize;
                const y = centerY + (worldY - this.posY) * cellSize;
                const clippedLeft = Math.max(x, left);
                const clippedTop = Math.max(y, top);
                const clippedRight = Math.min(x + cellSize, left + size);
                const clippedBottom = Math.min(y + cellSize, top + size);
                if (clippedRight > clippedLeft && clippedBottom > clippedTop) {
                    graphics.fillRect(
                        clippedLeft,
                        clippedTop,
                        clippedRight - clippedLeft,
                        clippedBottom - clippedTop
                    );
                }
            }
        }

        // Entity marker, when it is inside the minimap's visible area.
        if (this.entity?.active) {
            const entityX = centerX + (this.entity.x - this.posX) * cellSize;
            const entityY = centerY + (this.entity.y - this.posY) * cellSize;
            if (entityX >= left && entityX <= left + size && entityY >= top && entityY <= top + size) {
                graphics.fillStyle(0xd94343, 1);
                graphics.fillCircle(entityX, entityY, 2.5);
            }
        }

        // Player and facing direction.
        const tipX = centerX + this.dirX * 7;
        const tipY = centerY + this.dirY * 7;
        const sideX = -this.dirY * 3.5;
        const sideY = this.dirX * 3.5;
        graphics.fillStyle(0xffef80, 1);
        graphics.fillTriangle(
            tipX, tipY,
            centerX - this.dirX * 3 + sideX, centerY - this.dirY * 3 + sideY,
            centerX - this.dirX * 3 - sideX, centerY - this.dirY * 3 - sideY
        );

        graphics.lineStyle(2, 0xe8dfb1, 0.9);
        graphics.strokeRect(left, top, size, size);
    }

    canMove(nx, ny) {
        const r = 0.20;
        if (this.isDecorationBlocked(nx, ny, r)) return false;
        const checks = [
            [nx + r, ny], [nx - r, ny],
            [nx, ny + r], [nx, ny - r],
            [nx + r * 0.7, ny + r * 0.7],
            [nx - r * 0.7, ny + r * 0.7],
            [nx + r * 0.7, ny - r * 0.7],
            [nx - r * 0.7, ny - r * 0.7],
        ];
        for (const [x, y] of checks) {
            if (this.map.getCell(x | 0, y | 0)) return false;
        }
        return true;
    }

    isDecorationBlocked(x, y, radius = 0.2) {
        for (const prop of this.props || []) {
            if (Math.hypot(x - prop.x, y - prop.y) < radius + prop.radius) return true;
        }
        return false;
    }
    moveEntity(dt) {
        if (!this.entity.active) return;

        // creep toward player with a little wander
        const dx = this.posX - this.entity.x;
        const dy = this.posY - this.entity.y;
        const d = Math.hypot(dx, dy);

        // if too close, stop (you can add jumpscare here)
        if (d < 1.2) return;

        // simple steer + jitter
        const nx = dx / (d || 1);
        const ny = dy / (d || 1);
        const jitter = (Math.random() - 0.5) * 0.15;

        const tx = this.entity.x + (nx + jitter) * this.entity.speed * dt;
        const ty = this.entity.y + (ny - jitter) * this.entity.speed * dt;

        // collide against walls (same map as player)
        if (!this.map.getCell(tx | 0, this.entity.y | 0) && !this.isDecorationBlocked(tx, this.entity.y, 0.2)) {
            this.entity.x = tx;
        }
        if (!this.map.getCell(this.entity.x | 0, ty | 0) && !this.isDecorationBlocked(this.entity.x, ty, 0.2)) {
            this.entity.y = ty;
        }
    }

    update(time, delta) {
        const dt = Math.min(0.033, delta / 1000);

        this.map.ensureAround(this.posX, this.posY);
        this.props = this.map.getDecorationsAround(this.posX, this.posY);

        const base = this.keys.SHIFT.isDown ? 4.9 : 3.2;
        const moveSpeed = base * dt;
        const strafeSpeed = moveSpeed * 0.85;

        if (this.keys.W.isDown) {
            const nx = this.posX + this.dirX * moveSpeed;
            const ny = this.posY + this.dirY * moveSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }
        if (this.keys.S.isDown) {
            const nx = this.posX - this.dirX * moveSpeed;
            const ny = this.posY - this.dirY * moveSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }

        const perpX = this.dirY;
        const perpY = -this.dirX;
        if (this.keys.D.isDown) {
            const nx = this.posX + perpX * strafeSpeed;
            const ny = this.posY + perpY * strafeSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }
        if (this.keys.A.isDown) {
            const nx = this.posX - perpX * strafeSpeed;
            const ny = this.posY - perpY * strafeSpeed;
            if (this.canMove(nx, this.posY)) this.posX = nx;
            if (this.canMove(this.posX, ny)) this.posY = ny;
        }

        if (time > this.nextFlicker) {
            this.nextFlicker = time + 250 + Math.random() * 1200;
            const dip = Math.random() < 0.6;
            this.light = dip ? (0.45 + Math.random() * 0.35) : (0.9 + Math.random() * 0.2);
            setTimeout(() => this.light = 1.0, 60 + Math.random() * 200);
        }
        this.moveEntity(dt);

        this.ray.render({
            posX: this.posX, posY: this.posY,
            dirX: this.dirX, dirY: this.dirY,
            planeX: this.planeX, planeY: this.planeY,
            pitch: this.pitch,
            light: this.light,
            entity: this.entity,
            props: this.props
        });
        this.drawMinimap();
    }
}
