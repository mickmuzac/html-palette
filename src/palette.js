'use strict';

(function(jQuery, angular)
{
	// h, s, v [0,1]
	function hsvToRgb(h,s,v)
	{
		if( s === 0 ){
			return {r: v, g: v, b: v};
		}

		var i = Math.floor(h*6);
		var f = 6*h - i; // fractional part
		var p = v * (1 - s);
		var q = v * (1 - s*f);
		var t = v * (1 - s*(1-f));

		switch(i%6){
		case 0:
			return {r:v,g:t,b:p};
		case 1:
			return {r:q,g:v,b:p};
		case 2:
			return {r:p,g:v,b:t};
		case 3:
			return {r:p,g:q,b:v};
		case 4:
			return {r:t,g:p,b:v};
		default:
			return {r:v,g:p,b:q};
		}
	}

	function rgbToHsv(r,g,b)
	{
		var max = Math.max(r, g, b), min = Math.min(r, g, b);
	    var h, s, v = max;

	    var d = max - min;
	    s = max === 0 ? 0 : d / max;

	    if(max == min) {
	        h = 0; // achromatic
	    }
	    else {
	        switch(max) {
	            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
	            case g: h = (b - r) / d + 2; break;
	            case b: h = (r - g) / d + 4; break;
	        }
	        h /= 6;
	    }

	    return { h: h, s: s, v: v };
	}

	var template = [
		'<div class="palette">',
			'<canvas width="1" height="1"></canvas>',
			'<div class="twoaxis" draggable="true"></div>',
			'<div class="oneaxis" draggable="true"></div>',
		'</div>',
		'<div class="controls">',
			'<div class="rgbInput">',
				'#',
				'<span class="r" draggable="true"></span>',
				'<span class="g" draggable="true"></span>',
				'<span class="b" draggable="true"></span>',
			'</div>',
			'<div class="colorswatch"></div>',
		'</div>'
	].join('');

	var vertShaderSrc = [
		'precision lowp float;',
		'attribute vec3 vertPosition;',
		'varying vec2 windowPosition;',
		'uniform vec2 windowDimensions;',

		'void main(void)',
		'{',
			'mat3 xform = mat3(0.5*windowDimensions.x, 0.0, 0.0, 0.0, 0.5*windowDimensions.y, 0.0, windowDimensions.x/2.0, windowDimensions.y/2.0, 1.0);',
			'windowPosition = (xform * vec3(vertPosition.xy, 1.0)).xy;',
			'gl_Position = vec4(vertPosition,1);',
		'}'
	].join('\n');

	var fragShaderSrc = '<%= fragShader %>';

	document.addEventListener('click', function(evt)
	{
		var list = document.querySelectorAll('.htmlPalette');
		for(var i=0; i<list.length; i++){
			if(list.item(i) !== self.elem) list.item(i).style.display = 'none';
		}
	});

	var Palette = function(triggerElem, opts)
	{
		// add new color picker to the dom
		this.elem = document.createElement('div');
		this.elem.setAttribute('class', 'htmlPalette');
		this.elem.innerHTML = template;
		this.elem.onclick = function(e){ e.stopPropagation(); }
		document.body.appendChild(this.elem);

		this.triggerElem = triggerElem;
		this._onclick = Palette.onclick.bind(this);
		this.triggerElem.addEventListener('click', this._onclick);

		this.colorCallback = opts.colorCallback || null;
		this.popupEdge = opts.popupEdge || 'se';
		this.radial = opts.radial || false;

		this.selection = {};
		this._canvas = this.elem.querySelector('canvas');
		this._gl = this._canvas.getContext('webgl');
		var gl = this._gl;

		var popupStyle = window.getComputedStyle(this.elem);
		this._popupWidth = parseInt(popupStyle.width) || 0;
		this._popupHeight = parseInt(popupStyle.height) || 0;

		// size the canvas
		var style = window.getComputedStyle(this.elem.querySelector('.palette'));
		var w = parseInt(style.width), h = parseInt(style.height)-1;
		this._canvas.width = w;
		this._canvas.height = h;
		gl.viewport(0, 0, w, h);

		// size the overlay
		var paletteWidth = w-30;
		var twoaxis = this.elem.querySelector('.twoaxis');
		var oneaxis = this.elem.querySelector('.oneaxis')
		twoaxis.style.width = paletteWidth + 'px';
		twoaxis.style.height = h + 'px';
		oneaxis.style.height = h + 'px';

		this.elem.style.display = 'none';


		/********************************
		* Initialize the webgl canvas
		*********************************/

		// set up vert shader
		var vert = gl.createShader(gl.VERTEX_SHADER);
		gl.shaderSource(vert, vertShaderSrc);
		gl.compileShader(vert);
		if( !gl.getShaderParameter(vert, gl.COMPILE_STATUS) ){
			console.error('Vert shader error:', gl.getShaderInfoLog(vert));
			return;
		}

		// set up frag shader
		var frag = gl.createShader(gl.FRAGMENT_SHADER);
		gl.shaderSource(frag, fragShaderSrc);
		gl.compileShader(frag);
		if( !gl.getShaderParameter(frag, gl.COMPILE_STATUS) ){
			console.error('Frag shader error:', gl.getShaderInfoLog(frag));
			return;
		}

		// link shaders
		var program = this._program = gl.createProgram();
		gl.attachShader(program, vert);
		gl.attachShader(program, frag);
		gl.linkProgram(program);
		if( !gl.getProgramParameter(program, gl.LINK_STATUS) ){
			console.error('Unable to link program');
			return;
		}
		else {
			gl.useProgram(program);
		}

		var vertPositionAttrib = gl.getAttribLocation(program, 'vertPosition');
		gl.enableVertexAttribArray(vertPositionAttrib);

		var buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
			-1.0, -1.0, 0.0,
			-1.0,  1.0, 0.0,
			 1.0, -1.0, 0.0,
			 1.0,  1.0, 0.0
		]), gl.STATIC_DRAW);

		gl.vertexAttribPointer(vertPositionAttrib, 3, gl.FLOAT, false, 0, 0);

		this._selectionUniform = gl.getUniformLocation(program, 'selectedColor');
		gl.uniform1f(gl.getUniformLocation(program, 'swatchWidth'), 20);
		gl.uniform1f(gl.getUniformLocation(program, 'marginWidth'), 10);
		gl.uniform2f(gl.getUniformLocation(program, 'windowDimensions'), w,h);

		gl.clearColor(0.0, 0.0, 0.0, 0.0);
		this.color(opts.initialColor || 'aaaaaa');

		var self = this;

		twoaxis.ondragstart = function(evt){
			evt.dataTransfer.setDragImage(document.createElement('div'),0,0);
		}

		twoaxis.ondrag = twoaxis.onmousedown = function(evt){
			if( self.radial ){
				var center = [paletteWidth/2, h/2];
				var clickDiff = [evt.offsetX-1 - center[0], -(evt.offsetY-1) + center[1]];
				var hue = Math.atan2(clickDiff[1], clickDiff[0])/(2*Math.PI) + 0.5;
				var sat = Math.sqrt(clickDiff[0]*clickDiff[0] + clickDiff[1]*clickDiff[1]) / Math.min(center[0], center[1]);
				if( evt.screenX !== 0 || evt.screenY !== 0 )
					self.color({h: hue, s: Math.min(sat, 1.0)});
			}
			else if( evt.screenX !== 0 || evt.screenY !== 0 )
				self.color({h: Math.min(1, Math.max(0, (evt.offsetX-1)/paletteWidth)), s: Math.min(1, Math.max(0, (h-evt.offsetY+1)/(h-1)))});	
		}

		oneaxis.ondragstart = function(evt){
			evt.dataTransfer.setDragImage(document.createElement('div'),0,0);
		}

		oneaxis.ondrag = oneaxis.onmousedown = function(evt){
			if( evt.screenX !== 0 || evt.screenY !== 0 )
				self.color({v: Math.max(0, Math.min(1, (h-evt.offsetY-1)/(h-1)))});
		}

		var initialValue, initialMouse;

		function bindRGBElement(e, channel)
		{
			e.ondragstart = function(evt){
				initialValue = Math.round(self.selection[channel]*255);
				initialMouse = evt.offsetY;
				evt.dataTransfer.effectAllowed = 'none';
				evt.dataTransfer.setDragImage(document.createElement('div'),0,0);
			}

			e.ondrag = function(evt){
				//evt.preventDefault();
				var newVal = initialValue + initialMouse-evt.offsetY;
				if(evt.screenX !== 0 || evt.screenY !== 0){
					var color = {};
					color[channel] = Math.max(0, Math.min(1, newVal/255));
					self.color(color);
				}
			}
		}

		bindRGBElement(this.elem.querySelector('.r'), 'r');
		bindRGBElement(this.elem.querySelector('.g'), 'g');
		bindRGBElement(this.elem.querySelector('.b'), 'b');
	}

	Palette.onclick = function(evt)
	{
		evt.stopPropagation();

		var list = document.querySelectorAll('.htmlPalette');
		for(var i=0; i<list.length; i++)
		{
			if(list.item(i) !== this.elem || !this.elem.style.display){
				list.item(i).style.display = 'none';
			}
			else
			{
				var offset = 20;

				// fall back on sw on missing or invalid option
				if( !/^[ns]?[we]?$/.test(this.popupEdge) || !this.popupEdge )
					this.popupEdge = 'se';

				// set position vertically
				if(/^n/.test(this.popupEdge))
					this.elem.style.top = evt.clientY - this._popupHeight - offset + 'px';

				else if(/^s/.test(this.popupEdge))
					this.elem.style.top = evt.clientY + offset + 'px';

				else
					this.elem.style.top = evt.clientY - this._popupHeight/2 + 'px';

				// set position horizontally
				if(/e$/.test(this.popupEdge))
					this.elem.style.left = evt.clientX + offset + 'px';

				else if(/w$/.test(this.popupEdge))
					this.elem.style.left = evt.clientX - this._popupWidth - offset + 'px';

				else
					this.elem.style.left = evt.clientX - this._popupWidth/2 + 'px';

				this.elem.style.display = '';
			}
		}
	}

	Palette.prototype.redraw = function()
	{
		this._gl.uniform1i(this._gl.getUniformLocation(this._program, 'radial'), !!this.radial);
		this._gl.uniform3f(this._selectionUniform, this.selection.h, this.selection.s, this.selection.v);

		this._gl.clear(this._gl.COLOR_BUFFER_BIT);
		this._gl.drawArrays(this._gl.TRIANGLE_STRIP, 0, 4);
	}

	Palette.prototype.color = function(val)
	{
		if(val && (val.h!==undefined || val.s!==undefined || val.v!==undefined))
		{
			if(val.h !== undefined) this.selection.h = val.h;
			if(val.s !== undefined) this.selection.s = val.s;
			if(val.v !== undefined) this.selection.v = val.v;
			this.redraw();

			var rgb = hsvToRgb(this.selection.h, this.selection.s, this.selection.v);
			this.selection.r = Math.max(rgb.r, 0);
			this.selection.g = Math.max(rgb.g, 0);
			this.selection.b = Math.max(rgb.b, 0);

			this.selection.hex =
				('00'+Math.round(this.selection.r*255).toString(16)).slice(-2)
				+('00'+Math.round(this.selection.g*255).toString(16)).slice(-2)
				+('00'+Math.round(this.selection.b*255).toString(16)).slice(-2)

			if(this.colorCallback) this.colorCallback(this.selection);
		}
		else if(val && (val.r!==undefined || val.g!==undefined || val.b!==undefined))
		{
			if(val.r !== undefined) this.selection.r = val.r;
			if(val.g !== undefined) this.selection.g = val.g;
			if(val.b !== undefined) this.selection.b = val.b;

			var hsv = rgbToHsv(this.selection.r, this.selection.g, this.selection.b);

			this.selection.h = hsv.h;
			this.selection.s = hsv.s;
			this.selection.v = hsv.v;
			this.redraw();

			this.selection.hex =
				('00'+Math.round(this.selection.r*255).toString(16)).slice(-2)
				+('00'+Math.round(this.selection.g*255).toString(16)).slice(-2)
				+('00'+Math.round(this.selection.b*255).toString(16)).slice(-2)

			if(this.colorCallback) this.colorCallback(this.selection);
		}
		else if( /^[0-9A-Fa-f]{6}$/.test(val) )
		{
			this.selection.hex = val;

			val = parseInt(val, 16);
			this.selection.r = ((val & 0xff0000) >> 16) / 255;
			this.selection.g = ((val & 0x00ff00) >> 8) / 255;
			this.selection.b = (val & 0x0000ff) / 255;

			var hsv = rgbToHsv(this.selection.r, this.selection.g, this.selection.b);
			this.selection.h = hsv.h;
			this.selection.s = hsv.s;
			this.selection.v = hsv.v;
			this.redraw();

			if(this.colorCallback) this.colorCallback(this.selection);
		}

		this.elem.querySelector('.rgbInput .r').innerHTML = this.selection.hex.slice(0,2);
		this.elem.querySelector('.rgbInput .g').innerHTML = this.selection.hex.slice(2,4);
		this.elem.querySelector('.rgbInput .b').innerHTML = this.selection.hex.slice(4,6);
		this.elem.querySelector('.colorswatch').style['background-color'] = '#'+this.selection.hex;
	}

	Palette.prototype.setColorCallback = function(cb)
	{
		this.colorCallback = cb;
	}

	Palette.prototype.destroy = function()
	{
		document.body.removeChild(this.elem);
		this.triggerElem.removeEventListener('click', this._onclick)
	}


	window.HtmlPalette = Palette;

	if(jQuery)
	{
		jQuery.fn.extend({
			'htmlPalette': function(cmd)
			{
				var args = Array.prototype.slice.call(arguments, 1);
				var palette = this.data('htmlPalette');

				console.log(this);

				// when in doubt, return the palette object
				if(!cmd)
					return palette;

				// initialize
				else if(cmd instanceof Object)
				{
					if(palette)
						palette.destroy();

					palette = this.data('htmlPalette', new Palette(this[0], cmd));
					if(palette.colorCallback)
						palette.colorCallback = palette.colorCallback.bind(this);
				}

				// error on command without initialization
				else if(!palette) {
					throw new Error('HtmlPalette is uninitialized on this element');
				}

				// evaluate command
				else switch(cmd)
				{
					case 'color':
						if(args.length)
							palette.color(args[0]);
						else
							return palette.color();
						break;

					case 'colorCallback':
						if(args.length)
							palette.setColorCallback(args[0].bind(this));
						else
							return palette.colorCallback;
						break;

					case 'popupEdge':
						if(args.length)
							palette.popupEdge = args[0];
						else
							return palette.popupEdge;
						break;

					case 'radial':
						if(args.length){
							palette.radial = args[0];
							palette.redraw();
						}
						else
							return palette.radial;
						break;

					case 'redraw':
						palette.redraw();
						break;

					case 'destroy':
						palette.destroy();
						this.data('htmlPalette', null);
						break;
				}
			}
		});
	}


	if(angular)
	{
		var app = angular.module('html-palette', []);

		app.directive('htmlPalette', ['$timeout', function($timeout)
		{
			return {
				restrict: 'AE',
				scope: {
					hsvColor: '=',
					rgbColor: '=',
					hexColor: '='
				},
				link: function($scope, elem, attrs)
				{
					var palette = new Palette(elem[0], attrs);
					var dToW = false, wToD = false;

					if($scope.hsvColor)
					{
						palette.setColorCallback(function(color){
							if(!dToW)
							{
								wToD = true;
								$scope.hsvColor.h = color.h;
								$scope.hsvColor.s = color.s;
								$scope.hsvColor.v = color.v;

								if(!attrs.suppressBgColor)
									elem[0].style['background-color'] = '#'+color.hex;

								$timeout(function(){
									$scope.$apply();
									wToD = false;
								});
							}
						});

						$scope.$watchCollection('hsvColor', function(newval){
							if(newval && !wToD){
								dToW = true;
								palette.color(newval);
								dToW = false;
							}
						});
						
						palette.color($scope.hsvColor);
					}

					else if($scope.rgbColor)
					{
						palette.setColorCallback(function(color){
							if(!dToW)
							{
								wToD = true;
								$scope.rgbColor.r = color.r;
								$scope.rgbColor.g = color.g;
								$scope.rgbColor.b = color.b;

								if(!attrs.suppressBgColor)
									elem[0].style['background-color'] = '#'+color.hex;

								$timeout(function(){
									$scope.$apply();
									wToD = false;
								});
							}
						});

						$scope.$watchCollection('rgbColor', function(newval){
							if(newval && !wToD){
								dToW = true;
								palette.color(newval);
								dToW = false;
							}
						});

						palette.color($scope.rgbColor);
					}

					else if($scope.hexColor)
					{
						palette.setColorCallback(function(color){
							if(!dToW){
								wToD = true;
								$scope.hexColor = color.hex;

								if(!attrs.suppressBgColor)
									elem[0].style['background-color'] = '#'+color.hex;

								$timeout(function(){
									$scope.$apply();
									wToD = false;
								});
							}
						});

						$scope.$watch('hexColor', function(newval){
							if(newval && !wToD){
								dToW = true;
								palette.color(newval);
								dToW = false;
							}
						});

						palette.color($scope.hexColor);
					}

					palette.redraw();

					elem.bind('$destroy', function(){
						palette.destroy();
					});
				}
			};
		}]);
	}

})(window.jQuery, window.angular);
