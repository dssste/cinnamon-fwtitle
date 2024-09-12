const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const Applet = imports.ui.applet;
const AppletManager = imports.ui.appletManager;
const Main = imports.ui.main;
const SignalManager = imports.misc.signalManager;

const MAX_TEXT_LENGTH = 1000;

class PPSub {
	constructor(applet, metaWindow, transient) {
		this._applet = applet;
		this._windows = this._applet._windows;
		this.metaWindow = metaWindow;
		this.transient = transient;

		this.setDisplayTitle();
		this.onFocus();

		this._signals = new SignalManager.SignalManager();
		this._signals.connect(this.metaWindow, 'notify::title', this.setDisplayTitle, this);
		this._signals.connect(this.metaWindow, "notify::minimized", this.setDisplayTitle, this);
		this._signals.connect(this.metaWindow, "notify::tile-mode", this.setDisplayTitle, this);
		this._signals.connect(this.metaWindow, "notify::appears-focused", this.onFocus, this);
		this._signals.connect(this.metaWindow, "unmanaged", this.onUnmanaged, this);
	}

	onUnmanaged() {
		this.destroy();
		this._windows.splice(this._windows.indexOf(this), 1);
	}

	setDisplayTitle() {
		let title = this.metaWindow.get_title();
		let tracker = Cinnamon.WindowTracker.get_default();
		let app = tracker.get_window_app(this.metaWindow);

		if (!title) title = app ? app.get_name() : '?';

		title = title.replace(/\s/g, " ");
		if (title.length > MAX_TEXT_LENGTH)
			title = title.substr(0, MAX_TEXT_LENGTH);

		this._applet.set_applet_label(title);
	}

	destroy() {
		this._signals.disconnectAllSignals();
	}

	_hasFocus() {
		if (!this.metaWindow || this.metaWindow.minimized)
			return false;

		if (this.metaWindow.has_focus())
			return true;

		if (global.display.focus_window && this.metaWindow.is_ancestor_of_transient(global.display.focus_window))
			return true;

		return false
	}

	onFocus() {
		if(this._hasFocus()){
			this.setDisplayTitle();
		}
	}
};

function PPLet(orientation, panel_height, instance_id) {
	this._init(orientation, panel_height, instance_id);
}

PPLet.prototype = {
	__proto__: Applet.TextApplet.prototype,

	_init: function(orientation, panel_height, instance_id) {
		Applet.TextApplet.prototype._init.call(this, orientation, panel_height, instance_id);

		this.actor.set_track_hover(false);
		this.appletEnabled = false;

		this._windows = [];
		this._monitorWatchList = [];

		this.buttonWidth = 299;

		this._updateLabels();
		this.showAllWorkspaces = true;

		this.signals = new SignalManager.SignalManager(null);
		this.signals.connect(global.display, 'window-created', this._onWindowAddedAsync, this);
		this.signals.connect(global.display, 'window-monitor-changed', this._onWindowMonitorChanged, this);
		this.signals.connect(global.display, 'window-workspace-changed', this._onWindowWorkspaceChanged, this);
		this.signals.connect(global.display, 'window-skip-taskbar-changed', this._onWindowSkipTaskbarChanged, this);
		this.signals.connect(Main.panelManager, 'monitors-changed', this._updateWatchedMonitors, this);
		this.signals.connect(global.window_manager, 'switch-workspace', this._refreshAllItems, this);
		this.signals.connect(Cinnamon.WindowTracker.get_default(), "window-app-changed", this._onWindowAppChanged, this);
	},

	on_applet_added_to_panel(userEnabled) {
		this.appletEnabled = true;
	},

	on_applet_removed_from_panel() {
		this.signals.disconnectAllSignals();
		for (let window of windows) {
			window.destroy();
		}
	},

	on_applet_instances_changed() {
		this._updateWatchedMonitors();
	},

	on_panel_height_changed() {
		this._refreshAllItems();
	},

	on_panel_icon_size_changed(size) {
		this._refreshAllItems();
	},

	_onWindowAddedAsync(display, metaWindow, monitor) {
		Mainloop.timeout_add(20, Lang.bind(this, this._onWindowAdded, display, metaWindow, monitor));
	},

	_onWindowAdded(display, metaWindow, monitor) {
		if (this._shouldAdd(metaWindow))
			this._addWindow(metaWindow, false);
	},

	_onWindowMonitorChanged(display, metaWindow, monitor) {
		if (this._shouldAdd(metaWindow))
			this._addWindow(metaWindow, false);
		else {
			this.refreshing = true;
			this._removeWindow(metaWindow);
			this.refreshing = false;
		}
	},

	_refreshItemByMetaWindow(metaWindow) {
		let window = this._windows.find(win => (win.metaWindow == metaWindow));

		if (window)
			this._refreshItem(window);
	},

	_onWindowWorkspaceChanged(display, metaWindow, metaWorkspace) {
		this._refreshItemByMetaWindow(metaWindow);
	},

	_onWindowAppChanged(tracker, metaWindow) {
		this._refreshItemByMetaWindow(metaWindow);
	},

	_onWindowSkipTaskbarChanged(display, metaWindow) {
		if (metaWindow && metaWindow.is_skip_taskbar()) {
			this._removeWindow(metaWindow);
			return;
		}

		this._onWindowAdded(display, metaWindow, 0);
	},

	_refreshItem(window) {
		window.actor.visible =
			(window.metaWindow.get_workspace() == global.workspace_manager.get_active_workspace()) ||
			window.metaWindow.is_on_all_workspaces() ||
			this.showAllWorkspaces;

		/* The above calculates the visibility if it were the normal
		 * AppMenuButton. If this is actually a temporary AppMenuButton for
		 * urgent windows on other workspaces, it is shown iff the normal
		 * one isn't shown! */
		if (window.transient)
			window.actor.visible = !window.actor.visible;
	},

	_refreshAllItems() {
		for (let window of this._windows) {
			this._refreshItem(window);
		}
	},

	_reTitleItems() {
		for (let window of this._windows) {
			window.setDisplayTitle();
		}
	},

	_updateLabels() {
		for (let window of this._windows)
			window.updateLabelVisible();
	},

	_updateWatchedMonitors() {
		let n_mons = global.display.get_n_monitors();
		let on_primary = this.panel.monitorIndex == Main.layoutManager.primaryIndex;
		let instances = Main.AppletManager.getRunningInstancesForUuid(this._uuid);

		/* Simple cases */
		if (n_mons == 1) {
			this._monitorWatchList = [Main.layoutManager.primaryIndex];
		} else if (instances.length > 1 && !on_primary) {
			this._monitorWatchList = [this.panel.monitorIndex];
		} else {
			/* This is an instance on the primary monitor - it will be
			 * responsible for any monitors not covered individually.  First
			 * convert the instances list into a list of the monitor indices,
			 * and then add the monitors not present to the monitor watch list
			 * */
			this._monitorWatchList = [this.panel.monitorIndex];

			instances = instances.map(function(x) {
				return x.panel.monitorIndex;
			});

			for (let i = 0; i < n_mons; i++)
				if (instances.indexOf(i) == -1)
					this._monitorWatchList.push(i);
		}

		// Now track the windows in our favorite monitors
		let windows = global.display.list_windows(0);
		if (this.showAllWorkspaces) {
			for (let wks=0; wks<global.workspace_manager.n_workspaces; wks++) {
				let metaWorkspace = global.workspace_manager.get_workspace_by_index(wks);
				let wks_windows = metaWorkspace.list_windows();
				for (let wks_window of wks_windows) {
					windows.push(wks_window);
				}
			}
		}

		this.refreshing = true;

		for (let window of windows) {
			if (this._shouldAdd(window))
				this._addWindow(window, false);
			else
				this._removeWindow(window);
		}

		this.refreshing = false;
	},

	_addWindow(metaWindow, transient) {
		for (let window of this._windows)
			if (window.metaWindow == metaWindow &&
				window.transient == transient)
				return;

		let appButton = new PPSub(this, metaWindow, transient);

		this._windows.push(appButton);
	},

	_removeWindow(metaWindow) {
		let i = this._windows.length;
		while (i--) {
			if (this._windows[i].metaWindow == metaWindow) {
				this._windows[i].destroy();
				this._windows.splice(i, 1);
			}
		}
	},

	_shouldAdd(metaWindow) {
		return Main.isInteresting(metaWindow) &&
			!metaWindow.is_skip_taskbar() &&
			this._monitorWatchList.indexOf(metaWindow.get_monitor()) != -1;
	}
}

function main(metadata, orientation, panel_height, instance_id) {
	return new PPLet(orientation, panel_height, instance_id);
}
