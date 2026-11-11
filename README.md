# No Mercy Cards

A mobile-friendly No Mercy-inspired card game for private rooms of up to 10 players, with Easy, Medium, Hard and Extreme CPU opponents.

Play online: https://no-mercy-cards-i3fcsn.v2.appdeploy.ai/

The Android app is a lightweight WebView wrapper around the live game and requires an internet connection. Multiplayer rooms and CPU logic remain hosted by AppDeploy.

Source layout: src/ (React UI), backend/ (AppDeploy server routes), android/ (Android wrapper), and .github/workflows/ (APK build and release automation).

The backend uses AppDeploy database, invite and realtime services. Its source is included here, but GitHub Pages cannot host those server routes.

This is an independent house-rules card game inspired by high-chaos shedding games. It is not affiliated with or endorsed by Mattel or any official UNO product.
