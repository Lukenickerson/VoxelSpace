(function(){

"use strict";

// ---------------------------------------------
// Viewer information

const camera = {
	x:			512., // x position on the map
	y:			800., // y position on the map
	height:		78., // height of the camera
	angle:		0., // direction of the camera
	horizon:	100., // horizon position (look up and down)
	distance:	800   // distance of map
};

// ---------------------------------------------
// Landscape data

const map = {
	width:		1024,
	height:		1024,
	shift:		10,  // power of two: 2^10 = 1024
	altitude:	new Uint8Array(1024*1024), // 1024 * 1024 byte array with height information
	color:		new Uint32Array(1024*1024) // 1024 * 1024 int array with RGB colors
};

// ---------------------------------------------
// Screen data

const screen = {
	canvas:		null,
	context:	null,
	imageData:	null,

	bufArray:	null, // color data
	buf8:		null, // the same array but with bytes
	buf32:		null, // the same array but with 32-Bit words

	backgroundColor: 0xFFE09090
};

// ---------------------------------------------
// Keyboard and mouse interaction

const input = {
	forwardBackward: 0,
	leftRight:       0,
	upDown:          0,
	lookUp:          false,
	lookDown:        false,
	mousePosition:   null,
	keyPressed:      false
};

let updateRunning = false;
let time = new Date().getTime();
let timeLastFrame = new Date().getTime(); // for fps display
let frames = 0;

init();

return;

// Update the camera for next frame. Dependent on keypresses
function updateCamera() {
	const current = new Date().getTime();
	const movementScale = 0.03;
	const deltaTime = current - time;
	const deltaMovement = deltaTime * movementScale;

	input.keyPressed = false;
	if (input.leftRight != 0) {
		camera.angle += input.leftRight * 0.1 * deltaMovement;
		input.keyPressed = true;
	}
	if (input.forwardBackward != 0) {
		camera.x -= input.forwardBackward * Math.sin(camera.angle) * deltaMovement;
		camera.y -= input.forwardBackward * Math.cos(camera.angle) * deltaMovement;
		input.keyPressed = true;
	}
	if (input.upDown != 0) {
		camera.height += input.upDown * deltaMovement;
		input.keyPressed = true;
	}
	if (input.lookUp) {
		camera.horizon += 2 * deltaMovement;
		input.keyPressed = true;
	}
	if (input.lookDown) {
		camera.horizon -= 2 * deltaMovement;
		input.keyPressed = true;
	}

	// Collision detection. Don't fly below the surface.
	const mapOffset = ((Math.floor(camera.y) & (map.width-1)) << map.shift) + (Math.floor(camera.x) & (map.height-1))|0;
	const minZ = map.altitude[mapOffset] + 10;
	if (minZ > camera.height) {
		camera.height = minZ;
	}

	time = current;

}

// ---------------------------------------------
// Keyboard and mouse event handlers
// ---------------------------------------------
// Keyboard and mouse event handlers

function getMousePosition(e) {
	// fix for Chrome
	if (e.type.startsWith('touch')) {
		return [e.targetTouches[0].pageX, e.targetTouches[0].pageY];
	} else {
		return [e.pageX, e.pageY];
	}
}

function detectMouseDown(e) {
	input.forwardBackward = 3.;
	input.mousePosition = getMousePosition(e);
	time = new Date().getTime();

	if (!updateRunning) draw();
	return;
}

function detectMouseUp() {
	input.mousePosition = null;
	input.forwardBackward = 0;
	input.leftRight = 0;
	input.upDown = 0;
	return;
}

function detectMouseMove(e) {
	e.preventDefault();
	if (input.mousePosition == null) { return; }
	if (input.forwardBackward == 0) { return; }

	const currentMousePosition = getMousePosition(e);

	input.leftRight = (input.mousePosition[0] - currentMousePosition[0]) / window.innerWidth * 2;
	camera.horizon  = 100 + (input.mousePosition[1] - currentMousePosition[1]) / window.innerHeight * 500;
	input.upDown    = (input.mousePosition[1] - currentMousePosition[1]) / window.innerHeight * 10;
}

function detectKeysDown(e) {
	switch(e.keyCode) {
	case 37:    // left cursor
	case 65:    // a
		input.leftRight = +1.;
		break;
	case 39:    // right cursor
	case 68:    // d
		input.leftRight = -1.;
		break;
	case 38:    // cursor up
	case 87:    // w
		input.forwardBackward = 3.;
		break;
	case 40:    // cursor down
	case 83:    // s
		input.forwardBackward = -3.;
		break;
	case 82:    // r
		input.upDown = +2.;
		break;
	case 70:    // f
		input.upDown = -2.;
		break;
	case 69:    // e
		input.lookUp = true;
		break;
	case 81:    //q
		input.lookDown = true;
		break;
	default:
		return;
		break;
	}

	if (!updateRunning) {
		time = new Date().getTime();
		draw();
	}
	return false;
}

function detectKeysUp(e) {
	switch(e.keyCode) {
		case 37:	// left cursor
		case 65:	// a
			input.leftRight = 0;
			break;
		case 39:	// right cursor
		case 68:	// d
			input.leftRight = 0;
			break;
		case 38:	// cursor up
		case 87:	// w
			input.forwardBackward = 0;
			break;
		case 40:	// cursor down
		case 83:	// s
			input.forwardBackward = 0;
			break;
		case 82:	// r
			input.upDown = 0;
			break;
		case 70:	// f
			input.upDown = 0;
			break;
		case 69:	// e
			input.lookUp = false;
			break;
		case 81:	//q
			input.lookDown = false;
			break;
		default:
			return;
			break;
	}
	return false;
}

// ---------------------------------------------
// Fast way to draw vertical lines

function drawVerticalLine(x, ytop, ybottom, col) {
	x = x|0;
	ytop = ytop|0;
	ybottom = ybottom|0;
	col = col|0;
	const buf32 = screen.buf32;
	const screenWidth = screen.canvas.width|0;
	if (ytop < 0) { ytop = 0; }
	if (ytop > ybottom) { return; }

	// get offset on screen for the vertical line
	let offset = ((ytop * screenWidth) + x)|0;
	for (let k = ytop|0; k < ybottom|0; k=k+1|0) {
		buf32[offset|0] = col|0;
		offset = offset + screenWidth|0;
	}
}

// ---------------------------------------------
// Basic screen handling

function drawBackground() {
	const buf32 = screen.buf32;
	const color = screen.backgroundColor|0;
	for (let i = 0; i < buf32.length; i++) {
		buf32[i] = color|0;
	}
}

// Show the back buffer on screen
function flip() {
	screen.imageData.data.set(screen.buf8);
	screen.context.putImageData(screen.imageData, 0, 0);
}

// ---------------------------------------------
// The main render routine

function render() {
	const mapWidthPeriod = map.width - 1;
	const mapHeightPeriod = map.height - 1;

	const screenWidth = screen.canvas.width|0;
	const sinAng = Math.sin(camera.angle);
	const cosAng = Math.cos(camera.angle);

	const hiddenY = new Int32Array(screenWidth);
	for(let i=0; i<screen.canvas.width|0; i=i+1|0) {
		hiddenY[i] = screen.canvas.height;
	}

	let deltaZ = 1.;

	// draw from front to back
	for(let z=1; z<camera.distance; z+=deltaZ) {
		// 90 degree field of view
		let plx =  -cosAng * z - sinAng * z;
		let ply =   sinAng * z - cosAng * z;
		const prx =   cosAng * z - sinAng * z;
		const pry =  -sinAng * z - cosAng * z;

		const dx = (prx - plx) / screenWidth;
		const dy = (pry - ply) / screenWidth;
		plx += camera.x;
		ply += camera.y;
		const invz = 1. / z * 240.;
		for(let i=0; i<screenWidth|0; i=i+1|0) {
			const mapOffset = ((Math.floor(ply) & mapWidthPeriod) << map.shift) + (Math.floor(plx) & mapHeightPeriod)|0;
			let heightOnScreen = (camera.height - map.altitude[mapOffset]) * invz + camera.horizon|0;
			drawVerticalLine(i, heightOnScreen|0, hiddenY[i], map.color[mapOffset]);
			if (heightOnScreen < hiddenY[i]) {
				hiddenY[i] = heightOnScreen;
			}
			plx += dx;
			ply += dy;
		}
		deltaZ += 0.005;
	}
}


// ---------------------------------------------
// draw the next frame

function draw() {
	updateRunning = true;
	updateCamera();
	drawBackground();
	render();
	flip();
	frames++;

	if (!input.keyPressed) {
		updateRunning = false;
	} else {
		window.setTimeout(draw, 0);
	}
}

// ---------------------------------------------
// Init routines

// Util class for downloading the png
function downloadImagesAsync(urls) {
	return new Promise(function(resolve, reject) {
		let pending = urls.length;
		const result = [];
		if (pending === 0) {
			resolve([]);
			return;
		}
		urls.forEach(function(url, i) {
			const image = new Image();
			//image.addEventListener("load", function() {
			image.onload = function() {
				const tempCanvas = document.createElement("canvas");
				const tempContext = tempCanvas.getContext("2d");
				tempCanvas.width = map.width;
				tempCanvas.height = map.height;
				tempContext.drawImage(image, 0, 0, map.width, map.height);
				result[i] = tempContext.getImageData(0, 0, map.width, map.height).data;
				pending--;
				if (pending === 0) {
					resolve(result);
				}
			};
			image.src = url;
		});
	});
}

function loadMap(filenames) {
	const files = filenames.split(";");
	downloadImagesAsync(["maps/"+files[0]+".png", "maps/"+files[1]+".png"]).then(onLoadedImages);
}

function onLoadedImages(result) {
	const datac = result[0];
	const datah = result[1];
	for(let i=0; i<map.width*map.height; i++) {
		map.color[i] = 0xFF000000 | (datac[(i<<2) + 2] << 16) | (datac[(i<<2) + 1] << 8) | datac[(i<<2) + 0];
		map.altitude[i] = datah[i<<2];
	}
	draw();
}

function onResizeWindow() {
	screen.canvas = document.getElementById('fullscreenCanvas');

	const aspect = window.innerWidth / window.innerHeight;

	screen.canvas.width = window.innerWidth<800?window.innerWidth:800;
	screen.canvas.height = screen.canvas.width / aspect;

	if (screen.canvas.getContext) {
		screen.context = screen.canvas.getContext('2d');
		screen.imageData = screen.context.createImageData(screen.canvas.width, screen.canvas.height);
	}

	screen.bufArray = new ArrayBuffer(screen.imageData.width * screen.imageData.height * 4);
	screen.buf8     = new Uint8Array(screen.bufArray);
	screen.buf32    = new Uint32Array(screen.bufArray);
	draw();
}

function init() {
	for(let i=0; i<map.width*map.height; i++) {
		map.color[i] = 0xFF007050;
		map.altitude[i] = 0;
	}

	loadMap("C1W;D1");
	onResizeWindow();

	// set event handlers for keyboard, mouse, touchscreen and window resize
	const canvas = document.getElementById("fullscreenCanvas");
	canvas.onkeydown    = detectKeysDown;
	canvas.onkeyup      = detectKeysUp;
	canvas.onmousedown  = detectMouseDown;
	canvas.onmouseup    = detectMouseUp;
	canvas.onmousemove  = detectMouseMove;
	canvas.ontouchstart = detectMouseDown;
	canvas.ontouchend   = detectMouseUp;
	canvas.ontouchmove  = detectMouseMove;

	window.onresize = onResizeWindow;

	window.setInterval(function(){
		const current = new Date().getTime();
		document.getElementById('fps').innerText = (frames / (current-timeLastFrame) * 1000).toFixed(1) + " fps";
		frames = 0;
		timeLastFrame = current;
	}, 2000);
}

})();