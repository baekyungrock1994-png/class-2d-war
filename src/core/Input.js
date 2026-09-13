export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this._justPressed = new Set();

    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this._justPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    });
    canvas.addEventListener("mousedown", () => (this.mouseDown = true));
    window.addEventListener("mouseup", () => (this.mouseDown = false));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasJustPressed(code) {
    const hit = this._justPressed.has(code);
    return hit;
  }

  endFrame() {
    this._justPressed.clear();
  }
}
