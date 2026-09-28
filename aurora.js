var colors = [
  [62, 35, 255],
  [60, 255, 60],
  [255, 35, 98],
  [45, 175, 230],
  [255, 0, 255],
  [255, 128, 0]
];

var step = 0;
var colorIndices = [0, 1, 2, 3];
var gradientSpeed = 0.12;
var aurora = document.getElementById("aurora");
var last = 0;

function mix(from, to, t) {
  return Math.round(from + (to - from) * t);
}

function tone(rgb) {
  return rgb.map(function (channel) {
    return Math.round(channel * 0.62);
  });
}

function paint() {
  var leftFrom = tone(colors[colorIndices[0]]);
  var leftTo = tone(colors[colorIndices[1]]);
  var rightFrom = tone(colors[colorIndices[2]]);
  var rightTo = tone(colors[colorIndices[3]]);
  var left = "rgb(" + mix(leftFrom[0], leftTo[0], step) + "," + mix(leftFrom[1], leftTo[1], step) + "," + mix(leftFrom[2], leftTo[2], step) + ")";
  var right = "rgb(" + mix(rightFrom[0], rightTo[0], step) + "," + mix(rightFrom[1], rightTo[1], step) + "," + mix(rightFrom[2], rightTo[2], step) + ")";
  aurora.style.background = "linear-gradient(90deg, " + left + ", " + right + ")";
}

function advance(dt) {
  step += gradientSpeed * dt;
  if (step >= 1) {
    step %= 1;
    colorIndices[0] = colorIndices[1];
    colorIndices[2] = colorIndices[3];
    colorIndices[1] = (colorIndices[1] + Math.floor(1 + Math.random() * (colors.length - 1))) % colors.length;
    colorIndices[3] = (colorIndices[3] + Math.floor(1 + Math.random() * (colors.length - 1))) % colors.length;
  }
  paint();
}

paint();

if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  function frame(now) {
    if (!last) last = now;
    advance(Math.min(0.05, (now - last) / 1000));
    last = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
