/**
 * @provide pskl.tools.drawing.PaintBucket
 *
 * @require pskl.utils
 */
(function() {
  var ns = $.namespace('pskl.tools.drawing');

  ns.PaintBucket = function() {
    this.toolId = 'tool-paint-bucket';
    this.helpText = 'Paint bucket tool';
    this.shortcut = pskl.service.keyboard.Shortcuts.TOOL.PAINT_BUCKET;
  };

  pskl.utils.inherit(ns.PaintBucket, ns.BaseTool);

  /**
   * @override
   */
  ns.PaintBucket.prototype.applyToolAt = function(col, row, frame, overlay, event) {
    var color = this.getToolColor();
    var undoFrame = this.wrapFrameForUndo(frame);
    pskl.PixelUtils.paintSimilarConnectedPixelsFromFrame(undoFrame, col, row, color);

    this.raiseSaveStateEvent({
      col : col,
      row : row,
      color : color
    }, {
      affectsOnlyCurrentFrame : true,
      affectsOnlyCurrentLayer : true,
    }, {
      pixels : undoFrame.getUndoPixels(),
    });
  };

  ns.PaintBucket.prototype.replay = function (frame, replayData) {
    pskl.PixelUtils.paintSimilarConnectedPixelsFromFrame(frame, replayData.col, replayData.row, replayData.color);
  };

  ns.PaintBucket.prototype.undo = function (frame, undoData) {
    this.setPixelsToFrame(frame, undoData.pixels);
  };
})();
