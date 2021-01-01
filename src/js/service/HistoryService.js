(function () {
  var ns = $.namespace('pskl.service');

  ns.HistoryService = function (piskelController, shortcutService, deserializer, serializer) {
    // Use the real piskel controller that will not fire events when calling setters
    this.piskelController = piskelController.getWrappedPiskelController();

    this.shortcutService = shortcutService || pskl.app.shortcutService;
    this.deserializer = deserializer || pskl.utils.serialization.arraybuffer.ArrayBufferDeserializer;
    this.serializer = serializer || pskl.utils.serialization.arraybuffer.ArrayBufferSerializer;

    this.stateQueue = [];
    this.currentIndex = -1;
    this.lastLoadState = -1;
  };

  // Force to save a state as a SNAPSHOT
  ns.HistoryService.SNAPSHOT = 'SNAPSHOT';

  // Default save state
  ns.HistoryService.REPLAY = 'REPLAY';

  // Period (in number of state saved) between two snapshots
  ns.HistoryService.SNAPSHOT_PERIOD = 50;

  // Interval/buffer (in milliseconds) between two state load (ctrl+z/y spamming)
  ns.HistoryService.LOAD_STATE_INTERVAL = 50;

  // Maximum number of states that can be recorded.
  ns.HistoryService.MAX_SAVED_STATES = 500;

  ns.HistoryService.prototype.init = function () {
    $.subscribe(Events.PISKEL_SAVE_STATE, this.onSaveStateEvent.bind(this));

    var shortcuts = pskl.service.keyboard.Shortcuts;
    this.shortcutService.registerShortcut(shortcuts.MISC.UNDO, this.undo.bind(this));
    this.shortcutService.registerShortcut(shortcuts.MISC.REDO, this.redo.bind(this));

    this.saveState({
      type : ns.HistoryService.SNAPSHOT
    });
  };

  ns.HistoryService.prototype.onSaveStateEvent = function (evt, action) {
    this.saveState(action);
  };

  ns.HistoryService.prototype.saveState = function (action) {
    this.stateQueue = this.stateQueue.slice(0, this.currentIndex + 1);
    this.currentIndex = this.currentIndex + 1;

    var state = {
      action : action,
      frameIndex : action.state ? action.state.frameIndex : this.piskelController.currentFrameIndex,
      layerIndex : action.state ? action.state.layerIndex : this.piskelController.currentLayerIndex,
      fps : this.piskelController.getFPS(),
      uuid: pskl.utils.Uuid.generate()
    };

    var isSnapshot = action.type === ns.HistoryService.SNAPSHOT;
    var isAtAutoSnapshotInterval = this.currentIndex % ns.HistoryService.SNAPSHOT_PERIOD === 0;
    if (isSnapshot || isAtAutoSnapshotInterval) {
      var piskel = this.piskelController.getPiskel();
      state.piskel = this.serializer.serialize(piskel);
    }

    // If the new state pushes over MAX_SAVED_STATES, erase all states between the first and
    // second snapshot states.
    if (this.stateQueue.length > ns.HistoryService.MAX_SAVED_STATES) {
      var firstSnapshotIndex = this.getNextSnapshotIndex_(1);
      this.stateQueue.splice(0, firstSnapshotIndex);
      this.currentIndex = this.currentIndex - firstSnapshotIndex;
    }
    this.stateQueue.push(state);
    $.publish(Events.HISTORY_STATE_SAVED);
  };

  ns.HistoryService.prototype.getCurrentStateId = function () {
    var state = this.stateQueue[this.currentIndex];
    if (!state) {
      return false;
    }

    return state.uuid;
  };

  ns.HistoryService.prototype.mergeOptimization_ = function (state, output) {
    if (!output) {
      output = {};
    }
    if (state && state.action.optimize) {
      var optimize = state.action.optimize;

      if (!output.layersUnoptimizable && optimize.affectsOnlyCurrentLayer) {
        if (!output.affectedLayerIndexes) {
          output.affectedLayerIndexes = new Set();
        }
        output.affectedLayerIndexes.add(state.layerIndex);
      } else {
        delete output.affectedLayerIndexes;
        output.layersUnoptimizable = true;
      }

      if (!output.framesUnoptimizable && optimize.affectsOnlyCurrentFrame) {
        if (!output.affectedFrameIndexes) {
          output.affectedFrameIndexes = new Set();
        }
        output.affectedFrameIndexes.add(state.frameIndex);
      } else {
        delete output.affectedFrameIndexes;
        output.framesUnoptimizable = true;
      }
    }
    return output;
  };

  ns.HistoryService.prototype.getUndoOptimizationFunction_ = function (i) {
    var state = this.stateQueue[i];
    if (state && state.action.optimize) {
      return function () {
        return this.mergeOptimization_(state);
      }.bind(this);
    }
    return undefined;
  },

  ns.HistoryService.prototype.undo = function () {
    var index = this.currentIndex - 1;
    var optimizer = {
      getOptimization : this.getUndoOptimizationFunction_(this.currentIndex),
    };
    if (!this.fastTrackUndo_(index, optimizer)) {
      delete optimizer.optimization;
      this.loadState(index, optimizer);
    }
  };

  ns.HistoryService.prototype.redo = function () {
    var index = this.currentIndex + 1;
    var mergeOptimization = this.mergeOptimization_.bind(this);
    var optimizer = {
      onReplay : function (state) {
        this.optimization = mergeOptimization(state, this.optimization);
      },
      getOptimization : function () {
        return this.optimization;
      },
    };
    if (!this.fastTrackRedo_(index, optimizer)) {
      delete optimizer.optimization;
      this.loadState(index, optimizer);
    }
  };

  ns.HistoryService.prototype.fastTrackUndo_ = function (index, optimizer) {
    var indexToUndo = this.currentIndex;
    if (this.isLoadStateAllowed_(index) && this.stateQueue[indexToUndo].action.undo) {
      this.performReset_(index, optimizer, function () {
        this.undoState(this.stateQueue[indexToUndo]);
      }.bind(this));
      return true;
    } else {
      return false;
    }
  };

  ns.HistoryService.prototype.fastTrackRedo_ = function (index, optimizer) {
    if (this.isLoadStateAllowed_(index) && this.stateQueue[index].action.type === 'REPLAY') {
      this.replay_(index, this.currentIndex, optimizer);
      return true;
    } else {
      return false;
    }
  };

  ns.HistoryService.prototype.isLoadStateAllowed_ = function (index) {
    var timeOk = (Date.now() - this.lastLoadState) > ns.HistoryService.LOAD_STATE_INTERVAL;
    var indexInRange = index >= 0 && index < this.stateQueue.length;
    return timeOk && indexInRange;
  };

  ns.HistoryService.prototype.getPreviousSnapshotIndex_ = function (index) {
    while (this.stateQueue[index] && !this.stateQueue[index].piskel) {
      index = index - 1;
    }
    return index;
  };

  ns.HistoryService.prototype.getNextSnapshotIndex_ = function (index) {
    while (this.stateQueue[index] && !this.stateQueue[index].piskel) {
      index = index + 1;
    }
    return index;
  };

  ns.HistoryService.prototype.loadState = function (index, optimizer) {
    try {
      if (this.isLoadStateAllowed_(index)) {
        this.lastLoadState = Date.now();

        var snapshotIndex = this.getPreviousSnapshotIndex_(index);
        if (snapshotIndex < 0) {
          throw 'Could not find previous SNAPSHOT saved in history stateQueue';
        }
        var serializedPiskel = this.getSnapshotFromState_(snapshotIndex);
        var replayCallback = this.replay_.bind(this, index, snapshotIndex, optimizer);
        this.deserializer.deserialize(serializedPiskel, replayCallback);
      }
    } catch (error) {
      console.error('[CRITICAL ERROR] : Unable to load a history state.');
      this.logError_(error);
      this.stateQueue = [];
      this.currentIndex = -1;
    }
  };

  ns.HistoryService.prototype.logError_ = function (error) {
    if (typeof error === 'string') {
      console.error(error);
    } else {
      console.error(error.message);
      console.error(error.stack);
    }
  };

  ns.HistoryService.prototype.getSnapshotFromState_ = function (stateIndex) {
    var state = this.stateQueue[stateIndex];
    var piskelSnapshot = state.piskel;

    state.piskel = piskelSnapshot;

    return piskelSnapshot;
  };

  ns.HistoryService.prototype.normalizeOptimization_ = function (input) {
    var output = {};
    if (input) {
      if (!input.layersUnoptimizable && input.affectedLayerIndexes) {
        output.affectedLayerIndexes = Array.from(input.affectedLayerIndexes);
      }
      if (!input.framesUnoptimizable && input.affectedFrameIndexes) {
        output.affectedFrameIndexes = Array.from(input.affectedFrameIndexes);
      }
    }
    return output;
  };

  ns.HistoryService.prototype.replay_ = function (index, snapshotIndex, optimizer, piskel) {
    this.performReset_(index, optimizer, function () {
      // Fast-track redos don't load a new piskel.
      if (piskel) {
        piskel.setDescriptor(this.piskelController.piskel.getDescriptor());
        // propagate save path to the new piskel instance
        piskel.savePath = this.piskelController.piskel.savePath;
        this.piskelController.setPiskel(piskel);
      }

      for (var i = snapshotIndex + 1 ; i <= index ; i++) {
        var state = this.stateQueue[i];
        this.setupState(state);
        this.replayState(state);
        if (optimizer && optimizer.onReplay) {
          optimizer.onReplay(state);
        }
      }
    }.bind(this));
  };

  ns.HistoryService.prototype.performReset_ = function (index, optimizer, applyChanges) {
    var originalSize = this.getPiskelSize_();

    applyChanges();

    // Should only do this when going backwards
    var lastState = this.stateQueue[index + 1];
    if (lastState) {
      this.setupState(lastState);
    }

    var optimization;
    if (optimizer && optimizer.getOptimization) {
      optimization = this.normalizeOptimization_(optimizer.getOptimization());
    } else {
      optimization = this.normalizeOptimization_(null);
    }

    this.currentIndex = index;
    $.publish(Events.PISKEL_RESET, optimization);
    $.publish(Events.HISTORY_STATE_LOADED);
    if (originalSize !== this.getPiskelSize_()) {
      $.publish(Events.FRAME_SIZE_CHANGED);
    }
  };

  ns.HistoryService.prototype.getPiskelSize_ = function () {
    return this.piskelController.getWidth() + 'x' + this.piskelController.getHeight();
  };

  ns.HistoryService.prototype.setupState = function (state) {
    this.piskelController.setCurrentFrameIndex(state.frameIndex);
    this.piskelController.setCurrentLayerIndex(state.layerIndex);
    this.piskelController.setFPS(state.fps);
  };

  ns.HistoryService.prototype.replayState = function (state) {
    var action = state.action;
    var layer = this.piskelController.getLayerAt(state.layerIndex);
    var frame = layer.getFrameAt(state.frameIndex);
    action.scope.replay(frame, action.replay);
  };

  ns.HistoryService.prototype.undoState = function (state) {
    var action = state.action;
    var layer = this.piskelController.getLayerAt(state.layerIndex);
    var frame = layer.getFrameAt(state.frameIndex);
    action.scope.undo(frame, action.undo);
  };
})();
