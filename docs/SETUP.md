# ATS 初期設定と検証状況

接続先: `edxfhpdyxlenkrxsnirb`（Tokyo）。旧プロジェクトのデータは移行していません。

## 反映済みのバックエンド

- `initialize_ats_workspace`、`atomic_ats_bulk_update` を適用済み。`db/ats_schema.sql`、`db/ats_bulk_update.sql` は適用内容の記録です。同じプロジェクトへ再実行しないでください。
- 13テーブル、会社単位のRLS、管理者・採用担当・面接官の権限、選考変更履歴、原子的な一括選考更新。
- `applicant-files` は非公開。10MB上限、ファイル種別制限、会社/候補者別パス、5分の署名付きURL。
- `send-mail` Edge Function をJWT検証有効で配置済み。実際のメールは送信していません。
- ATS Workspace、求人例、タグ、メールテンプレートを初期登録済み。候補者・実ユーザーは未登録。

## 1. 最初の管理者

1. [Authentication / Users](https://supabase.com/dashboard/project/edxfhpdyxlenkrxsnirb/auth/users) で本人のメールアドレスのユーザーを作成し、メール確認を完了する。パスワードは本人が管理し、チャットやGitHubへ記載しない。
2. `db/provision_member.sql` のメールアドレス・表示名を本人の値に置き換え、Supabase SQL Editorで実行する。最初の権限は `admin`。Auth登録だけではATSへアクセスできない。
3. 公開したATSのログイン画面でメールアドレスとパスワードを入力する。

追加メンバーにも同じ手順を使用。権限は `admin` / `recruiter` / `interviewer`。プロフィールの権限変更はブラウザから許可しない。面接官は割り当て済み候補者を閲覧し、自分の評価を編集する。管理者と採用担当は自社候補者を管理できる。社内メンバー一覧は同じ会社の有効ユーザーに共有される。

## 2. メール送信

Resendのアカウントと送信ドメインの認証が必要。[Edge Function Secrets](https://supabase.com/dashboard/project/edxfhpdyxlenkrxsnirb/functions/secrets) に以下を設定する。

| 名前 | 値 |
| --- | --- |
| `RESEND_API_KEY` | Resend APIキー（秘密値） |
| `ATS_MAIL_FROM` | 認証済みドメインの送信元。例: `採用担当 <recruiting@your-domain.example>` |
| `ATS_ALLOWED_ORIGINS` | ATSを開くorigin。例: `https://ats.your-domain.example`。複数はカンマ区切り、末尾スラッシュ・パスなし |

Supabase標準のURLとサーバー鍵はFunction内の環境変数から取得。秘密鍵を `lib/api.js` に入れない。ブラウザにあるpublishable keyは公開用で、権限制御はRLSとサーバー側で行う。

送信先・文面は候補者とテンプレートからサーバーが確定する。利用者単位10件/分、同一リクエストの二重送信抑止あり。タイムアウト時は同じ操作で再試行する。23時間を超えた古い要求は履歴とResend側を確認する。実送信の試験は宛先本人の了承を得たテストアドレスで行う。

## 3. フロントエンド公開とAuth設定

この変更はドラフトPR。mainへのマージ・フロントエンド公開は未実施。

静的ホスティングのルートに `index.html`、`list.html`、`detail.html`、`lib/` を配置する。HTTPSを使用。ローカル確認はリポジトリルートで `python3 -m http.server 8000`、`http://localhost:8000/` を開く。メールをローカル試験する場合のみそのoriginも上記許可リストに追加する。

Supabase AuthのSite URL・許可redirect URLを実際の公開先へ合わせる。招待制で運用する場合は公開signupを無効にする。現在のプラグインではAuth設定値を確認・変更できておらず、これらの適用済みとはみなさない。パスワード再設定画面・MFA導線は今回の実装に含まれない。

## 検証

- Node 22.13以上で `npm ci && npm test`。クライアント・jsdom画面・メールFunctionの13件が成功。ネットワークはモックであり、実ブラウザや実ログイン・メール配送のE2E試験ではない。
- `tests/rls.sql` を接続先で実行し成功。会社間の読み書き拒否、外部キー、自己昇格拒否、面接官の範囲、無効/未登録ユーザー、匿名アクセス、非公開書類、履歴、メールRPCを確認。テスト用Auth/DB行はトランザクション末尾でロールバック。
- Supabase Security Advisorsの指摘0件（準備時点）。包括的な安全性保証ではない。
- 候補者追加、メモ保存、実メンバー表示、危険なHTML属性除去、失敗時に成功表示しない処理を検証。

管理者作成後、実ログイン→候補者追加→選考変更→書類upload/download→担当面接官の閲覧範囲→テストメールの順に確認してから運用開始する。元の画面の全機能を完成させたわけではなく、写真の永続化などは別途実装が必要。

参考: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Storageアクセス制御](https://supabase.com/docs/guides/storage/security/access-control)、[Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets)、[Resend](https://resend.com/docs/introduction)
