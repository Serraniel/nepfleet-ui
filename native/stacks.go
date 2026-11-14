// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import (
	"context"
	"fmt"
	"strings"

	qt "github.com/mappu/miqt/qt6"
)

// StacksPage lists a connected fleet's stacks, plans and applies them.
type StacksPage struct {
	a       *App
	w       *qt.QWidget
	fleet   *qt.QComboBox
	table   *qt.QTableWidget
	detail  *qt.QPlainTextEdit
	planBtn *qt.QPushButton
	apply   *qt.QPushButton
	fleets  []string
	stacks  []Stack
	plan    *Plan
	timer   *qt.QTimer
}

func newStacksPage(a *App) *StacksPage {
	p := &StacksPage{a: a, w: qt.NewQWidget2()}
	lay := qt.NewQVBoxLayout2()

	top := qt.NewQHBoxLayout2()
	top.AddWidget(qt.NewQLabel3("Fleet").QWidget)
	p.fleet = qt.NewQComboBox2()
	p.fleet.SetMinimumWidth(220)
	p.fleet.OnCurrentIndexChanged(func(int) { p.loadStacks() })
	top.AddWidget(p.fleet.QWidget)
	top.AddStretch()
	lay.AddLayout(top.QLayout)

	split := qt.NewQSplitter3(qt.Vertical)
	p.table = qt.NewQTableWidget3(0, 5)
	p.table.SetHorizontalHeaderLabels([]string{"Stack", "State", "Host", "Template", "Updates"})
	p.table.SetSelectionBehavior(qt.QAbstractItemView__SelectRows)
	p.table.SetSelectionMode(qt.QAbstractItemView__SingleSelection)
	p.table.SetEditTriggers(qt.QAbstractItemView__NoEditTriggers)
	p.table.HorizontalHeader().SetStretchLastSection(true)
	p.table.VerticalHeader().Hide()
	p.table.OnItemSelectionChanged(func() {
		p.plan = nil
		p.detail.SetPlainText("")
		p.updateButtons()
	})
	split.AddWidget(p.table.QWidget)
	p.detail = qt.NewQPlainTextEdit2()
	p.detail.SetReadOnly(true)
	p.detail.SetPlaceholderText("Select a stack, then Plan to see what applying it would change.")
	split.AddWidget(p.detail.QWidget)
	lay.AddWidget(split.QWidget)

	buttons := qt.NewQHBoxLayout2()
	p.planBtn = qt.NewQPushButton3("Plan")
	p.apply = qt.NewQPushButton3("Apply this plan")
	p.planBtn.OnClicked(p.doPlan)
	p.apply.OnClicked(p.doApply)
	buttons.AddWidget(p.planBtn.QWidget)
	buttons.AddWidget(p.apply.QWidget)
	buttons.AddStretch()
	lay.AddLayout(buttons.QLayout)
	p.w.SetLayout(lay.QLayout)
	p.updateButtons()
	return p
}

func (p *StacksPage) remote() string {
	i := p.fleet.CurrentIndex()
	if i < 0 || i >= len(p.fleets) {
		return ""
	}
	return p.fleets[i]
}

func (p *StacksPage) selected() (Stack, bool) {
	i := p.table.CurrentRow()
	if i < 0 || i >= len(p.stacks) || len(p.table.SelectedItems()) == 0 {
		return Stack{}, false
	}
	return p.stacks[i], true
}

func (p *StacksPage) updateButtons() {
	_, ok := p.selected()
	p.planBtn.SetEnabled(ok)
	p.apply.SetEnabled(ok && p.plan != nil && p.plan.ID != "")
}

// Reload lists the connected fleets.
func (p *StacksPage) Reload() {
	var rs []Remote
	bg(func(ctx context.Context) (err error) { rs, err = p.a.d.Remotes(ctx); return err }, func(err error) {
		if err != nil {
			p.a.status.SetText(err.Error())
			return
		}
		current := p.remote()
		p.fleets = nil
		p.fleet.Clear()
		for _, r := range rs {
			if r.Tunnel == "up" {
				p.fleets = append(p.fleets, r.Name)
				p.fleet.AddItem(r.Name + "  (" + r.Address + ")")
			}
		}
		if len(p.fleets) == 0 {
			p.detail.SetPlainText("No fleet is connected. Connect a machine running NepFleet on the Machines page.")
		}
		for i, n := range p.fleets {
			if n == current {
				p.fleet.SetCurrentIndex(i)
			}
		}
	})
}

func (p *StacksPage) loadStacks() {
	remote := p.remote()
	p.table.SetRowCount(0)
	p.stacks = nil
	if remote == "" {
		return
	}
	var st []Stack
	bg(func(ctx context.Context) (err error) { st, err = p.a.d.Stacks(ctx, remote); return err }, func(err error) {
		if err != nil {
			p.detail.SetPlainText("Listing stacks: " + err.Error())
			return
		}
		p.stacks = st
		p.table.SetRowCount(len(st))
		for i, s := range st {
			state := s.State
			if state == "" {
				state = "—"
			}
			tpl := s.Template
			if tpl == "" {
				tpl = "plain compose"
			}
			for col, text := range []string{s.Name, state, s.Target, tpl, s.Updates} {
				p.table.SetItem(i, col, qt.NewQTableWidgetItem2(text))
			}
		}
		p.table.ResizeColumnsToContents()
		p.updateButtons()
	})
}

func (p *StacksPage) doPlan() {
	s, ok := p.selected()
	remote := p.remote()
	if !ok || remote == "" {
		return
	}
	p.detail.SetPlainText("Planning " + s.Name + "…")
	var plan Plan
	bg(func(ctx context.Context) (err error) { plan, err = p.a.d.Plan(ctx, remote, s.Name); return err }, func(err error) {
		if err != nil {
			p.detail.SetPlainText("Planning: " + err.Error())
			return
		}
		p.plan = &plan
		p.detail.SetPlainText(describePlan(s.Name, plan))
		p.updateButtons()
	})
}

func describePlan(name string, plan Plan) string {
	var b strings.Builder
	if len(plan.Changes) == 0 && len(plan.Steps) == 0 {
		fmt.Fprintf(&b, "%s is up to date: applying changes nothing.\n", name)
		return b.String()
	}
	if len(plan.Destructive) > 0 {
		b.WriteString("Destructive:\n")
		for _, d := range plan.Destructive {
			fmt.Fprintf(&b, "  ! %s\n", d)
		}
		b.WriteString("\n")
	}
	if len(plan.Steps) > 0 {
		b.WriteString("Steps:\n")
		for i, st := range plan.Steps {
			mark := ""
			if st.Destructive {
				mark = "  (destructive)"
			}
			fmt.Fprintf(&b, "  %d. %s%s\n", i+1, st.Text, mark)
		}
		b.WriteString("\n")
	}
	for _, c := range plan.Changes {
		fmt.Fprintf(&b, "%s %s\n", c.Kind, c.Path)
		if c.Diff != "" {
			b.WriteString(c.Diff)
			if !strings.HasSuffix(c.Diff, "\n") {
				b.WriteString("\n")
			}
		}
	}
	return b.String()
}

func (p *StacksPage) doApply() {
	s, ok := p.selected()
	remote := p.remote()
	if !ok || remote == "" || p.plan == nil {
		return
	}
	confirm := false
	if len(p.plan.Destructive) > 0 {
		text := qt.QInputDialog_GetText(p.a.win.QWidget, "Destructive changes",
			"This plan has destructive changes:\n"+strings.Join(p.plan.Destructive, "\n")+"\n\nType the stack's name to apply it:")
		if text != s.Name {
			return
		}
		confirm = true
	}
	plan := *p.plan
	p.apply.SetEnabled(false)
	p.detail.SetPlainText("Applying " + s.Name + "…")
	var job Job
	bg(func(ctx context.Context) (err error) {
		job, err = p.a.d.Apply(ctx, remote, s.Name, plan.ID, confirm)
		return err
	}, func(err error) {
		if err != nil {
			p.detail.SetPlainText("Applying: " + err.Error())
			p.updateButtons()
			return
		}
		p.follow(remote, job.ID)
	})
}

func (p *StacksPage) follow(remote, id string) {
	if p.timer != nil {
		p.timer.Stop()
	}
	p.timer = qt.NewQTimer2(p.w.QObject)
	p.timer.SetInterval(1500)
	busy := false
	p.timer.OnTimeout(func() {
		if busy {
			return
		}
		busy = true
		var job Job
		bg(func(ctx context.Context) (err error) { job, err = p.a.d.Job(ctx, remote, id); return err }, func(err error) {
			busy = false
			if err != nil {
				return
			}
			p.detail.SetPlainText(job.Log)
			if job.State == "running" {
				return
			}
			p.timer.Stop()
			if job.State == "failed" {
				p.detail.AppendPlainText("\nFailed: " + job.Error)
			} else {
				p.detail.AppendPlainText("\nApplied.")
			}
			p.plan = nil
			p.loadStacks()
		})
	})
	p.timer.Start2()
}
