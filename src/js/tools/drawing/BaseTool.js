/**
 * @provide pskl.tools.drawing.BaseTool
 *
 * @require pskl.utils
 */
(function() {
  var ns = $.namespace('pskl.tools.drawing');

  ns.BaseTool = function() {
    pskl.tool.Tool.call(this);
    this.toolId = 'tool-base';
  };

  pskl.utils.inherit(ns.BaseTool, pskl.tools.Tool);

  ns.BaseTool.prototype.applyToolAt = function (col, row, frame, overlay, event) {};

  ns.BaseTool.prototype.moveToolAt = function (col, row, frame, overlay, event) {};

  ns.BaseTool.prototype.replay = Constants.ABSTRACT_FUNCTION;

  ns.BaseTool.prototype.undo = Constants.ABSTRACT_FUNCTION;

  ns.BaseTool.prototype.supportsDynamicPenSize = function() {
    return false;
  };

  ns.BaseTool.prototype.getToolColor = function() {
    if (pskl.app.mouseStateService.isRightButtonPressed()) {
      return pskl.app.selectedColorsService.getSecondaryColor();
    }
    return pskl.app.selectedColorsService.getPrimaryColor();
  };

  ns.BaseTool.prototype.moveUnactiveToolAt = function (col, row, frame, overlay, event) {
    if (overlay.containsPixel(col, row)) {
      this.updateHighlightedPixel(frame, overlay, col, row);
    } else {
      this.hideHighlightedPixel(overlay);
    }
  };

  ns.BaseTool.prototype.updateHighlightedPixel = function (frame, overlay, col, row) {
    if (!isNaN(this.highlightedPixelCol) &&
      !isNaN(this.highlightedPixelRow) &&
      (this.highlightedPixelRow != row ||
        this.highlightedPixelCol != col)) {

      // Clean the previously highlighted pixel:
      overlay.clear();
    }

    var frameColor = pskl.utils.intToColor(frame.getPixel(col, row));
    var highlightColor = this.getHighlightColor_(frameColor);
    var size = this.supportsDynamicPenSize() ? pskl.app.penSizeService.getPenSize() : 1;
    pskl.PixelUtils.resizePixel(col, row, size).forEach(function (point) {
      overlay.setPixel(point[0], point[1], highlightColor);
    });

    this.highlightedPixelCol = col;
    this.highlightedPixelRow = row;
  };

  ns.BaseTool.prototype.getHighlightColor_ = function (frameColor) {
    if (!frameColor) {
      return Constants.TOOL_HIGHLIGHT_COLOR_DARK;
    }

    var luminance = window.tinycolor(frameColor).toHsl().l;
    if (luminance > 0.5) {
      return Constants.TOOL_HIGHLIGHT_COLOR_DARK;
    } else {
      return Constants.TOOL_HIGHLIGHT_COLOR_LIGHT;
    }
  };

  ns.BaseTool.prototype.hideHighlightedPixel = function (overlay) {
    if (this.highlightedPixelRow !== null && this.highlightedPixelCol !== null) {
      overlay.clear();
      this.highlightedPixelRow = null;
      this.highlightedPixelCol = null;
    }
  };

  ns.BaseTool.prototype.releaseToolAt = function (col, row, frame, overlay, event) {};

  /**
   * Does the tool support the ALT modifier. To be overridden by subclasses.
   *
   * @return {Boolean} true if the tool supports ALT.
   */
  ns.BaseTool.prototype.supportsAlt = function () {
    return false;
  };

  ns.BaseTool.prototype.setPixelsToFrame = function (frame, pixels) {
    pixels.forEach(function (pixel) {
      frame.setPixel(pixel.col, pixel.row, pixel.color);
    });
  };

  ns.BaseTool.prototype.wrapFrameForUndo = function (frame, initialUndoPixelMap) {
    // Intercept each setPixel call and see if we need to remember its state.
    // Some tools like to set the same pixel multiple times, so we have to
    // keep track of which ones we already remembered to not clobber ourselves.
    var wrapper = Object.create(frame);

    if (initialUndoPixelMap) {
      wrapper.gotten = new Set(initialUndoPixelMap.keys());
      wrapper.undoPixels = Array.from(initialUndoPixelMap.values());
    } else {
      wrapper.gotten = new Set();
      wrapper.undoPixels = [];
    }

    wrapper.setUndoPixel_ = function (x, y, color) {
      var index = y * this.getWidth() + x;
      if (!this.gotten.has(index)) {
        this.gotten.add(index);
        this.undoPixels.push({
          col : x,
          row : y,
          color : this.getPixel(x, y),
        });
      }
    };

    wrapper.setPixel = function (x, y, color) {
      this.setUndoPixel_(x, y, color);
      Object.getPrototypeOf(this).setPixel(x, y, color);
    };

    wrapper.getUndoPixels = function () {
      return this.undoPixels;
    };

    return wrapper;
  };
})();
