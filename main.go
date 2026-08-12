package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := application.New(application.Options{
		Name:        "Obsidian COS Images",
		Description: "Manage PicGo / Tencent COS images used by Obsidian Markdown notes",
		Services: []application.Service{
			application.NewService(NewConfigService()),
			application.NewService(NewCOSService()),
			application.NewService(NewVaultService()),
			application.NewService(NewCleanupService()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Obsidian COS Images",
		Width:  1200,
		Height: 800,
		Mac: application.MacWindow{
			Backdrop: application.MacBackdropNormal,
			TitleBar: application.MacTitleBarDefault,
		},
		BackgroundColour: application.NewRGB(250, 250, 250),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
