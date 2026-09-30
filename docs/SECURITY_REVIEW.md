# 公開前セルフレビュー — 2026-09-29

対象: PR #1 の静的HTML/JavaScript、接続先 edxfhpdyxlenkrxsnirb の実DB権限。認証迂回がないことの絶対保証や第三者による侵入試験ではありません。

以下は時点ごとの記録です。最新状態は末尾の2026-09-30追記を参照してください。

## 結果

HTMLの認証チェックを消したりlocalStorageのroleをadminへ書き換えるだけで、候補者データにアクセスできる経路は今回の範囲では確認されませんでした。UIの表示自体は利用者が変更できますが、権限はSupabaseの署名済みトークンとDBの有効プロフィールで決まります。HTMLに管理者パスワード・service_role/secret keyはありません。publishable keyは公開を前提としたキーです。

- 実HTTP: 公開キーのみでapplicantsを取得→401。偽JWTを付けた同じ取得→401。
- 実DB: 13テーブルすべてRLS有効、匿名テーブル権限なし。プロフィール書き換えによる自己昇格拒否、他社の読み書き拒否、担当面接官の範囲、無効/未登録ユーザー拒否、Storage会社間アクセス拒否、クライアントからメール予約RPC呼出拒否を確認。fixtureはROLLBACK済み。
- 関数: 公開RPCはSECURITY INVOKER。メール予約はservice_roleのみ。内部SECURITY DEFINERは非公開スキーマに置き、固定search_pathと現在ユーザーの確認あり。
- 書類: private bucket。署名URLは5分有効で、そのURLの所持者は期間内アクセス可能。ユーザー無効化で発行済み署名URLが即時無効になる設計ではありません。
- メールFunction: サーバー側ユーザー検証・役割検証あり。送信先はDBから確定。モック試験で確認し、実配送は未実施。
- 16件のNode/jsdom/モックFunctionテスト成功。偽トークンとlocalStorage管理者偽装の拒否、サーバー権限での上書きを追加。

## 修正

3画面へContent Security Policyを追加。実行可能なインラインJSはSHA-256で固定し、インラインイベントハンドラ・eval・外部スクリプト・外部フォーム送信・baseタグを制限。接続先は対象Supabaseのみ、画像は同一originまたはdata URLのみ。これはDOMPurifyに加える防御です。

インラインスクリプト変更時は `node scripts/update-csp.cjs` を実行してから `npm test`。jsdomはCSPを強制しないため、テストはポリシー内容/ハッシュと画面ロジックを検証するもので、実ブラウザでのCSP検証の代替ではありません。

新規タブはnoopener/noreferrer、ページ全体はno-referrer。候補者詳細URLのIDをエンコード。

## 未完了・公開条件

1. Security Advisorsが漏洩済みパスワード保護の無効を1件報告。現在のプラグインにはAuth設定更新機能がなく未変更。管理画面で利用可否を確認して有効化する。以前の「指摘0件」は今回の最新結果に置き換える。
   https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
2. Authのsignup公開設定、パスワードポリシー、レート制限、MFA、セッション失効時間は包括的には確認できていない。未登録者がAuthアカウントを作れても、ATSプロフィールがなければDBアクセスはできない。
3. 公開先でHTTPSとHTTPレスポンスヘッダー `Content-Security-Policy: frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` を設定する。frame-ancestorsはmetaタグでは効かない。HTML/JSと必要静的ファイルだけを公開し、SQL・テスト・設定手順は配信しない。
4. 公開後、実ブラウザで正常ログイン・ログアウト・権限拒否・CSP・書類取得を確認する。まだ公開していない。
5. トークンはlocalStorage保存でHttpOnly cookieではない。XSS発生時のセッション窃取リスクは残るため、本番で実個人情報を扱う前にHttpOnly cookieを使うサーバー構成への移行と追加レビューを検討する。今回のCSPはこれを完全解消しない。

## 同日追加対応 — サーバー側セッションへ移行

上記レビュー後に `server/app.cjs` を追加。**localStorageへのトークン保存は廃止**し、旧キーを削除。Supabaseトークンはサーバーメモリ内のみ、ブラウザには32バイト乱数IDの `__Host-ats_session` Cookie（HttpOnly / Secure / SameSite=Strict / Path=/）。正常ログインでIDを新規発行し、サーバー内の期限は無操作30分・最大8時間。

APIに固定origin検査とX-ATS-Requestヘッダーを要求し、CORS非公開。サーバーで毎回Auth userと有効プロフィールを照合。クライアントのAuthorizationやCookieを上流へ転送せず、当該セッションのユーザートークンを使う。ログアウト後の同じIDはサーバーで即拒否。Supabase logoutが通信失敗してもアプリセッションは削除するが、既に外部へ漏れたSupabase JWTや既発行の書類署名URLの即時失効は保証しない。プロフィール無効化は次のAPI要求から拒否する。

セキュリティHTTPヘッダーと静的ファイル許可リストをNodeへ実装。SQL、設定手順、サーバーソース、テスト、package.jsonは404。公開後にもリバースプロキシがヘッダーを維持し、キャッシュしないことを確認する。

検証: 21件成功。Nodeに実HTTPでリクエストし、Cookie属性/トークン非返却、偽Cookie、CSRF、失効、プロフィール無効化、共有refresh、ログイン試行制限、非公開ファイル配信拒否を確認（上流Auth/APIはモック）。jsdomで一覧/候補者作成/詳細保存が動作。実ブラウザでlocalhostを開く試験は `ERR_BLOCKED_BY_CLIENT` により未実施。実際の本人ログインと公開HTTPSでのCookie/CSP確認は未完了。

Supabase settingsの読取で一般signup有効を確認。招待制へ変更する管理画面はクラウドブラウザでサインインが必要なため未変更。漏洩済みパスワード保護はPro以上の機能と公式資料で確認。料金プラン変更なし。

HttpOnlyはトークンのJSからの読取を防ぎますが、XSSが成立した場合にそのブラウザで本人権限の操作を行うことまでは防げません。DOMPurify・CSP・サーバー認可は引き続き必要です。メモリ内セッションと制限は単一Nodeプロセス向けで、本番の複数台構成には共有ストア等が必要です。

参考: https://supabase.com/docs/guides/auth/server-side/advanced-guide 、https://supabase.com/docs/guides/auth/sessions 、https://supabase.com/docs/guides/auth/password-security

## 2026-09-30 — Auth設定とデプロイ準備

Supabase管理画面で一般signup無効、Secure password change有効、Require current password when updating有効、最低長12を保存して再表示確認。メール確認有効・匿名ログイン無効は維持。漏洩済みパスワード保護はPro以上のため無効のまま。既存パスワード変更なし。前節の「signup未変更」は以前の状態です。

Render Free単一プロセス向けの配置設定と非root Dockerfileを追加。productionではHTTPS originを要求し、Renderでは環境変数の既定URLを検証して使用。アプリ/APIのHost検査は維持。内部HostのGET/HEAD `/healthz` だけは情報を含まないプロセス応答確認を許可し、Supabaseへの問い合わせやセッション発行を行いません。

25件の自動テスト成功（従来21件に環境設定3件・ヘルスチェック1件を追加）。プラットフォームURL、productionのHTTP拒否、未設定/不正PORTの起動拒否、内部Host例外が認証APIへ広がらないことを確認。公開後の匿名アクセスとHTTPヘッダー検査用スクリプトを追加。ただし公開URL未作成のため同スクリプトの実環境実行、実本人ログイン、Dockerビルド、公開ブラウザのCookie/CSP確認は未実施。メール配送・写真永続化・パスワード再設定/MFA導線も未完了。
