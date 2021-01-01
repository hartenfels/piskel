/**
 * @provide pskl.tools.drawing.SimplePen
 *
 * @require pskl.utils
 */
(function() {
  var ns = $.namespace('pskl.tools.drawing');

  ns.SimplePen = function() {
    this.toolId = 'tool-pen';
    this.helpText = 'Pen tool';
    this.shortcut = pskl.service.keyboard.Shortcuts.TOOL.PEN;

    this.previousCol = null;
    this.previousRow = null;

    this.pixels = [];
    this.undoPixels = new Map();
  };

  pskl.utils.inherit(ns.SimplePen, ns.BaseTool);

  ns.SimplePen.prototype.supportsDynamicPenSize = function() {
    return true;
  };

  /**
   * @override
   */
  ns.SimplePen.prototype.applyToolAt = function(col, row, frame, overlay, event) {
    this.previousCol = col;
    this.previousRow = row;

    var color = this.getToolColor();

    this.drawUsingPenSize(color, col, row, frame, overlay);
  };

  ns.SimplePen.prototype.drawUsingPenSize = function(color, col, row, frame, overlay) {
    var penSize = pskl.app.penSizeService.getPenSize();
    var points = pskl.PixelUtils.resizePixel(col, row, penSize);
    points.forEach(function (point) {
      this.draw(color, point[0], point[1], frame, overlay);
    }.bind(this));
  };

  ns.SimplePen.prototype.draw = function(color, col, row, frame, overlay) {
    overlay.setPixel(col, row, color);
    if (color === Constants.TRANSPARENT_COLOR) {
      var index = row * frame.getWidth() + col;
      if (!this.undoPixels.has(index)) {
        this.undoPixels.set(index, {
          col : col,
          row : row,
          color : frame.getPixel(col, row),
        });
      }
      frame.setPixel(col, row, color);
    }
    this.pixels.push({
      col : col,
      row : row,
      color : color
    });
  };

  /**
   * @override
   */
  ns.SimplePen.prototype.moveToolAt = function(col, row, frame, overlay, event) {
    if ((Math.abs(col - this.previousCol) > 1) || (Math.abs(row - this.previousRow) > 1)) {
      // The pen movement is too fast for the mousemove frequency, there is a gap between the
      // current point and the previously drawn one.
      // We fill the gap by calculating missing dots (simple linear interpolation) and draw them.
      var interpolatedPixels = pskl.PixelUtils.getLinePixels(col, this.previousCol, row, this.previousRow);
      for (var i = 0, l = interpolatedPixels.length ; i < l ; i++) {
        var coords = interpolatedPixels[i];
        this.applyToolAt(coords.col, coords.row, frame, overlay, event);
      }
    } else {
      this.applyToolAt(col, row, frame, overlay, event);
    }

    this.previousCol = col;
    this.previousRow = row;
  };

  ns.SimplePen.prototype.releaseToolAt = function(col, row, frame, overlay, event) {
    // apply on real frame
    var undoFrame = this.wrapFrameForUndo(frame, this.undoPixels);
    this.setPixelsToFrame(undoFrame, this.pixels);

    // save state
    this.raiseSaveStateEvent({
      pixels : this.pixels.slice(0),
    }, {
      affectsOnlyCurrentFrame : true,
      affectsOnlyCurrentLayer : true,
    }, {
      pixels : undoFrame.getUndoPixels(),
    });

    // reset
    this.resetUsedPixels_();
  };

  ns.SimplePen.prototype.replay = function (frame, replayData) {
    this.setPixelsToFrame(frame, replayData.pixels);
  };

  ns.SimplePen.prototype.undo = function (frame, undoData) {
    this.setPixelsToFrame(frame, undoData.pixels);
  };

  ns.SimplePen.prototype.resetUsedPixels_ = function() {
    this.pixels = [];
    this.undoPixels.clear();
  };
})();
