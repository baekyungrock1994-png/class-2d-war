// Makes a guest's network-reported input look like the local Input class so the
// host can run the exact same Player.update()/tryShoot() logic for remote
// players as it does for its own local player — no separate remote-control code
// path to keep in sync.
export class RemoteInputAdapter {
  constructor() {
    this.keys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.remoteFacing = 0;
    this._justPressed = new Set();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasJustPressed(code) {
    return this._justPressed.has(code);
  }

  // Called by the host once per tick with the guest's latest reported payload.
  applyPayload(payload) {
    this.keys.clear();
    if (payload.up) this.keys.add("KeyW");
    if (payload.down) this.keys.add("KeyS");
    if (payload.left) this.keys.add("KeyA");
    if (payload.right) this.keys.add("KeyD");
    if (payload.reload) this.keys.add("KeyR");

    this.mouseDown = !!payload.mouseDown;
    if (typeof payload.facing === "number") this.remoteFacing = payload.facing;
  }
}
