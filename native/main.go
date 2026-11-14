// SPDX-License-Identifier: AGPL-3.0-or-later

// Command nepfleet-native is NepFleet's desktop app with the operating system's
// own controls (Qt Widgets): a client of the local control daemon, as the web
// UI is. Closing the window hides it to the tray; starting it again shows it.
package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"time"

	qt "github.com/mappu/miqt/qt6"
	"github.com/mappu/miqt/qt6/mainthread"
)

// App is the window and what it shows.
type App struct {
	d        *Daemon
	win      *qt.QMainWindow
	status   *qt.QLabel
	machines *MachinesPage
	stacks   *StacksPage
}

// bg runs work off the UI thread, then done on it with work's error.
func bg(work func(ctx context.Context) error, done func(error)) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		err := work(ctx)
		mainthread.Wait(func() { done(err) })
	}()
}

// singleInstance: a second start asks the first to show its window, then ends.
func singleInstance(show func()) (first bool) {
	dir := os.Getenv("XDG_RUNTIME_DIR")
	if dir == "" {
		dir = controlDir()
	}
	sock := filepath.Join(dir, "nepfleet-native.sock")
	if c, err := net.DialTimeout("unix", sock, time.Second); err == nil {
		_, _ = c.Write([]byte("show\n"))
		_ = c.Close()
		return false
	}
	_ = os.Remove(sock)
	l, err := net.Listen("unix", sock)
	if err != nil {
		return true // no single instance, but the app still works
	}
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
			mainthread.Wait(show)
		}
	}()
	return true
}

func icon() *qt.QIcon {
	for _, name := range []string{"nepfleet", "network-server", "computer"} {
		if i := qt.QIcon_FromTheme(name); !i.IsNull() {
			return i
		}
	}
	return qt.NewQIcon()
}

func main() {
	qt.NewQApplication(os.Args)
	qt.QGuiApplication_SetQuitOnLastWindowClosed(false)
	qt.QGuiApplication_SetApplicationDisplayName("NepFleet")
	qt.QGuiApplication_SetWindowIcon(icon())

	a := &App{d: newDaemon()}
	show := func() {
		a.win.Show()
		a.win.Raise()
		a.win.ActivateWindow()
	}
	if !singleInstance(func() { show() }) {
		return
	}
	a.build()
	a.tray(show)
	show()
	a.status.SetText("Starting the NepFleet daemon…")
	bg(a.d.Ensure, func(err error) {
		if err != nil {
			a.status.SetText(err.Error())
			return
		}
		a.status.SetText("Connected to the NepFleet daemon on this computer.")
		a.machines.Refresh()
	})
	// For documentation and tests: save the window as an image, then quit.
	if shot := os.Getenv("NEPFLEET_NATIVE_SCREENSHOT"); shot != "" {
		t := qt.NewQTimer2(a.win.QObject)
		t.SetSingleShot(true)
		t.OnTimeout(func() {
			a.win.Grab().Save(shot)
			qt.QCoreApplication_Quit()
		})
		t.Start(5000)
	}
	qt.QApplication_Exec()
}

func (a *App) build() {
	a.win = qt.NewQMainWindow2()
	a.win.SetWindowTitle("NepFleet")
	a.win.Resize(1000, 650)
	// Closing hides to the tray; Quit in the tray menu ends the app. The daemon
	// and its tunnels keep running either way.
	a.win.OnCloseEvent(func(_ func(*qt.QCloseEvent), ev *qt.QCloseEvent) {
		ev.Ignore()
		a.win.Hide()
	})

	nav := qt.NewQListWidget2()
	nav.AddItem("Machines")
	nav.AddItem("Stacks")
	nav.SetMaximumWidth(180)
	pages := qt.NewQStackedWidget2()
	a.machines = newMachinesPage(a)
	a.stacks = newStacksPage(a)
	pages.AddWidget(a.machines.w)
	pages.AddWidget(a.stacks.w)
	nav.OnCurrentRowChanged(func(row int) {
		pages.SetCurrentIndex(row)
		if row == 1 {
			a.stacks.Reload()
		}
	})
	nav.SetCurrentRow(0)

	split := qt.NewQSplitter2()
	split.AddWidget(nav.QWidget)
	split.AddWidget(pages.QWidget)
	split.SetStretchFactor(1, 1)
	split.SetSizes([]int{160, 840})
	a.win.SetCentralWidget(split.QWidget)

	a.status = qt.NewQLabel2()
	a.win.StatusBar().AddWidget(a.status.QWidget)
}

func (a *App) tray(show func()) {
	if !qt.QSystemTrayIcon_IsSystemTrayAvailable() {
		return // starting the app again shows the window
	}
	t := qt.NewQSystemTrayIcon2(icon())
	t.SetToolTip("NepFleet")
	menu := qt.NewQMenu2()
	menu.AddActionWithText("Open NepFleet").OnTriggered(show)
	menu.AddSeparator()
	menu.AddActionWithText("Quit").OnTriggered(func() { qt.QCoreApplication_Quit() })
	t.SetContextMenu(menu)
	t.OnActivated(func(reason qt.QSystemTrayIcon__ActivationReason) {
		if reason == qt.QSystemTrayIcon__Trigger {
			show()
		}
	})
	t.Show()
}

// errorBox shows an error next to the window.
func (a *App) errorBox(title string, err error) {
	qt.QMessageBox_Warning(a.win.QWidget, title, err.Error())
}
