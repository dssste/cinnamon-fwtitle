const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const Applet = imports.ui.applet;
const AppletManager = imports.ui.appletManager;
const Main = imports.ui.main;
const SignalManager = imports.misc.signalManager;

const MAX_TEXT_LENGTH = 1000;

class AppMenuButton {
	constructor(applet, metaWindow, transient) {
		this.actor = new Cinnamon.GenericContainer({
			name: 'appMenu',
			style_class: 'window-list-item-box',
			reactive: true,
			can_focus: true,
			track_hover: true });

		this._applet = applet;
		this.metaWindow = metaWindow;
		this.transient = transient;

		this.drawLabel = false;
		this.labelVisiblePref = false;
		this._signals = new SignalManager.SignalManager();
		this.xid = metaWindow.get_xwindow();

		if (this._applet.orientation == St.Side.TOP)
			this.actor.add_style_class_name('top');
		else if (this._applet.orientation == St.Side.BOTTOM)
			this.actor.add_style_class_name('bottom');
		else if (this._applet.orientation == St.Side.LEFT)
			this.actor.add_style_class_name('left');
		else if (this._applet.orientation == St.Side.RIGHT)
			this.actor.add_style_class_name('right');

		this.actor._delegate = this;

		this._signals.connect(this.actor, 'get-preferred-width', Lang.bind(this, this._getPreferredWidth));
		this._signals.connect(this.actor, 'get-preferred-height', Lang.bind(this, this._getPreferredHeight));
		this._signals.connect(this.actor, 'allocate', Lang.bind(this, this._allocate));

		this._iconBox = new Cinnamon.Slicer({ name: 'appMenuIcon' });
		this.actor.add_actor(this._iconBox);

		this._label = new St.Label();
		this.actor.add_actor(this._label);

		this.updateLabelVisible();

		this._windows = this._applet._windows;

		this.setDisplayTitle();
		this.onFocus();

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

		this._label.set_text(title);
	}

	destroy() {
		this._signals.disconnectAllSignals();
		this.actor.destroy();
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
		} else {
			this._label.set_text("[ ]");
		}
	}

	_getPreferredWidth(actor, forHeight, alloc) {
		let [minSize, naturalSize] = this._iconBox.get_preferred_width(forHeight);

		alloc.min_size = 1 * global.ui_scale;

		if (this._applet.orientation == St.Side.TOP || this._applet.orientation == St.Side.BOTTOM ) {
			// the 'buttons use entire space' option only makes sense on horizontal panels with labels
			if (this.labelVisiblePref) {
				alloc.natural_size = this._applet.buttonWidth * global.ui_scale;
			} else {
				alloc.natural_size = naturalSize
			}
		} else {
			alloc.natural_size = this._applet._panelHeight;
		}
	}

	_getPreferredHeight(actor, forWidth, alloc) {
		let [minSize1, naturalSize1] = this._iconBox.get_preferred_height(forWidth);

		if (this.labelVisiblePref) {
			let [minSize2, naturalSize2] = this._label.get_preferred_height(forWidth);
			alloc.min_size = Math.max(minSize1, minSize2);
		} else {
			alloc.min_size = minSize1;
		}

		if (this._applet.orientation == St.Side.TOP || this._applet.orientation == St.Side.BOTTOM ) {
			/* putting a container around the actor for layout management reasons affects the allocation,
							 causing the visible border to pull in close around the contents which is not the desired
							 (pre-existing) behaviour, so need to push the visible border back towards the panel edge.
							 Assigning the natural size to the full panel height used to cause recursion errors but seems fine now.
							 If this happens to avoid this you can subtract 1 or 2 pixels, but this will give an unreactive
							 strip at the edge of the screen */
			alloc.natural_size = this._applet._panelHeight;
		} else {
			alloc.natural_size = naturalSize1;
		}
	}

	_allocate(actor, box, flags) {
		let allocWidth = box.x2 - box.x1;
		let allocHeight = box.y2 - box.y1;

		let childBox = new Clutter.ActorBox();

		let [minWidth, minHeight, naturalWidth, naturalHeight] = this._iconBox.get_preferred_size();

		let direction = this.actor.get_text_direction();
		let spacing = Math.floor(this.actor.get_theme_node().get_length('spacing'));
		let yPadding = Math.floor(Math.max(0, allocHeight - naturalHeight) / 2);

		childBox.y1 = box.y1 + yPadding;
		childBox.y2 = childBox.y1 + Math.min(naturalHeight, allocHeight);

		if (allocWidth < naturalWidth) {
			this.labelVisible = false;
		} else {
			this.labelVisible = this.labelVisiblePref;
		}

		if (this.drawLabel) {
			if (direction === Clutter.TextDirection.LTR) {
				childBox.x1 = box.x1;
			} else {
				childBox.x1 = Math.max(box.x1, box.x2 - naturalWidth);
			}
			childBox.x2 = Math.min(childBox.x1 + naturalWidth, box.x2);
		} else {
			childBox.x1 = box.x1 + Math.floor(Math.max(0, allocWidth - naturalWidth) / 2);
			childBox.x2 = Math.min(childBox.x1 + naturalWidth, box.x2);
		}
		this._iconBox.allocate(childBox, flags);

		if (this.drawLabel) {
			[minWidth, minHeight, naturalWidth, naturalHeight] = this._label.get_preferred_size();

			yPadding = Math.floor(Math.max(0, allocHeight - naturalHeight) / 2);
			childBox.y1 = box.y1 + yPadding;
			childBox.y2 = childBox.y1 + Math.min(naturalHeight, allocHeight);
			if (direction === Clutter.TextDirection.LTR) {
				// Reuse the values from the previous allocation
				childBox.x1 = Math.min(childBox.x2 + spacing, box.x2);
				childBox.x2 = box.x2;
			} else {
				childBox.x2 = Math.max(childBox.x1 - spacing, box.x1);
				childBox.x1 = box.x1;
			}

			this._label.allocate(childBox, flags);
		}

		childBox.x1 = 0;
		childBox.y1 = 0;
		childBox.x2 = this.actor.width;
		childBox.y2 = this.actor.height;
	}

	updateLabelVisible() {
		this._label.show();
		this.labelVisiblePref = true;
		this.drawLabel = true;
	}
};

class PPlet extends Applet.Applet {
	constructor(orientation, panel_height, instance_id) {
		super(orientation, panel_height, instance_id);

		this.signals = new SignalManager.SignalManager(null);

		this.setAllowedLayout(Applet.AllowedLayout.BOTH);

		this.actor.set_track_hover(false);
		this.actor.set_style_class_name("window-list-box");
		this.orientation = orientation;
		this.appletEnabled = false;
		//
		// A layout manager is used to cater for vertical panels as well as horizontal
		//
		let manager;
		if (this.orientation == St.Side.TOP || this.orientation == St.Side.BOTTOM) {
			manager = new Clutter.BoxLayout( { orientation: Clutter.Orientation.HORIZONTAL });
		} else {
			manager = new Clutter.BoxLayout( { orientation: Clutter.Orientation.VERTICAL });
			this.actor.add_style_class_name("vertical");
		}

		this.manager = manager;
		this.manager_container = new Clutter.Actor( { layout_manager: manager } );
		this.actor.add_actor (this.manager_container);

		this.dragInProgress = false;
		this._tooltipShowing = false;
		this._tooltipErodeTimer = null;
		this._menuOpen = false;
		this._urgentSignal = null;
		this._windows = [];
		this._monitorWatchList = [];

		this.buttonWidth = 299;

		this._updateLabels();
		this.showAllWorkspaces = true;

		this.signals.connect(global.display, 'window-created', this._onWindowAddedAsync, this);
		this.signals.connect(global.display, 'window-monitor-changed', this._onWindowMonitorChanged, this);
		this.signals.connect(global.display, 'window-workspace-changed', this._onWindowWorkspaceChanged, this);
		this.signals.connect(global.display, 'window-skip-taskbar-changed', this._onWindowSkipTaskbarChanged, this);
		this.signals.connect(Main.panelManager, 'monitors-changed', this._updateWatchedMonitors, this);
		this.signals.connect(global.window_manager, 'switch-workspace', this._refreshAllItems, this);
		this.signals.connect(Cinnamon.WindowTracker.get_default(), "window-app-changed", this._onWindowAppChanged, this);

		this.signals.connect(this.actor, 'style-changed', Lang.bind(this, this._updateSpacing));

		this.on_orientation_changed(orientation);
	}

	on_applet_added_to_panel(userEnabled) {
		this._updateSpacing();
		this.appletEnabled = true;
	}

	on_applet_removed_from_panel() {
		this.signals.disconnectAllSignals();
	}

	on_applet_instances_changed() {
		this._updateWatchedMonitors();
	}

	on_panel_height_changed() {
		this._refreshAllItems();
	}

	on_panel_icon_size_changed(size) {
		this._refreshAllItems();
	}

	on_orientation_changed(orientation) {
		this.orientation = orientation;

		for (let window of this._windows)
			window.updateLabelVisible();

		if (orientation == St.Side.TOP || orientation == St.Side.BOTTOM) {
			this.manager.set_vertical(false);
			this._reTitleItems();
			this.actor.remove_style_class_name("vertical");
		} else {
			this.manager.set_vertical(true);
			this.actor.add_style_class_name("vertical");
			this.actor.set_x_align(Clutter.ActorAlign.CENTER);
			this.actor.set_important(true);
		}

		if (orientation == St.Side.TOP) {
			for (let child of this.manager_container.get_children()) {
				child.set_style_class_name('window-list-item-box top');
				child.set_style('margin-top: 0px; padding-top: 0px;');
			}
			this.actor.set_style('margin-top: 0px; padding-top: 0px;');
		} else if (orientation == St.Side.BOTTOM) {
			for (let child of this.manager_container.get_children()) {
				child.set_style_class_name('window-list-item-box bottom');
				child.set_style('margin-bottom: 0px; padding-bottom: 0px;');
			}
			this.actor.set_style('margin-bottom: 0px; padding-bottom: 0px;');
		} else if (orientation == St.Side.LEFT) {
			for (let child of this.manager_container.get_children()) {
				child.set_style_class_name('window-list-item-box left');
				child.set_style('margin-left 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;');
				child.set_x_align(Clutter.ActorAlign.CENTER);
			}
			this.actor.set_style('margin-left: 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;');
		} else if (orientation == St.Side.RIGHT) {
			for (let child of this.manager_container.get_children()) {
				child.set_style_class_name('window-list-item-box right');
				child.set_style('margin-left: 0px; padding-left: 0px; padding-right: 0px; margin-right: 0px;');
				child.set_x_align(Clutter.ActorAlign.CENTER);
			}
			this.actor.set_style('margin-right: 0px; padding-right: 0px; padding-left: 0px; margin-left: 0px;');
		}

		if (this.appletEnabled) {
			this._updateSpacing();
		}
	}

	_updateSpacing() {
		let themeNode = this.actor.get_theme_node();
		let spacing = themeNode.get_length('spacing');
		this.manager.set_spacing(spacing * global.ui_scale);
	}

	_onWindowAddedAsync(display, metaWindow, monitor) {
		Mainloop.timeout_add(20, Lang.bind(this, this._onWindowAdded, display, metaWindow, monitor));
	}

	_onWindowAdded(display, metaWindow, monitor) {
		if (this._shouldAdd(metaWindow))
			this._addWindow(metaWindow, false);
	}

	_onWindowMonitorChanged(display, metaWindow, monitor) {
		if (this._shouldAdd(metaWindow))
			this._addWindow(metaWindow, false);
		else {
			this.refreshing = true;
			this._removeWindow(metaWindow);
			this.refreshing = false;
		}
	}

	_refreshItemByMetaWindow(metaWindow) {
		let window = this._windows.find(win => (win.metaWindow == metaWindow));

		if (window)
			this._refreshItem(window);
	}

	_onWindowWorkspaceChanged(display, metaWindow, metaWorkspace) {
		this._refreshItemByMetaWindow(metaWindow);
	}

	_onWindowAppChanged(tracker, metaWindow) {
		this._refreshItemByMetaWindow(metaWindow);
	}

	_onWindowSkipTaskbarChanged(display, metaWindow) {
		if (metaWindow && metaWindow.is_skip_taskbar()) {
			this._removeWindow(metaWindow);
			return;
		}

		this._onWindowAdded(display, metaWindow, 0);
	}

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
	}

	_refreshAllItems() {
		for (let window of this._windows) {
			this._refreshItem(window);
		}
	}

	_reTitleItems() {
		for (let window of this._windows) {
			window.setDisplayTitle();
		}
	}

	_updateLabels() {
		for (let window of this._windows)
			window.updateLabelVisible();
	}

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
	}

	_addWindow(metaWindow, transient) {
		for (let window of this._windows)
			if (window.metaWindow == metaWindow &&
				window.transient == transient)
				return;

		let appButton = new AppMenuButton(this, metaWindow, transient);
		this.manager_container.add_actor(appButton.actor);

		this._windows.push(appButton);

		/* We want to make the AppMenuButtons look like they are ordered by
		 * workspace. So if we add an AppMenuButton for a window in another
		 * workspace, put it in the right position. It is at the end by
		 * default, so move it to the start if needed */
		if (transient) {
			if (metaWindow.get_workspace().index() < global.workspace_manager.get_active_workspace_index())
				this.manager_container.set_child_at_index(appButton.actor, 0);
		} else {
			if (metaWindow.get_workspace() != global.workspace_manager.get_active_workspace()) {
				if (!(this.showAllWorkspaces)) {
					appButton.actor.hide();
				}
			}
		}
	}

	_removeWindow(metaWindow) {
		let i = this._windows.length;
		// Do an inverse loop because we might remove some elements
		while (i--) {
			if (this._windows[i].metaWindow == metaWindow) {
				this._windows[i].destroy();
				this._windows.splice(i, 1);
			}
		}
	}

	_shouldAdd(metaWindow) {
		return Main.isInteresting(metaWindow) &&
			!metaWindow.is_skip_taskbar() &&
			this._monitorWatchList.indexOf(metaWindow.get_monitor()) != -1;
	}
}

function main(metadata, orientation, panel_height, instance_id) {
	return new PPlet(orientation, panel_height, instance_id);
}
