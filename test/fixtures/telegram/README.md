# Telegram Bot API fixtures

These files are **not captured from Telegram.** They are written by hand from the Telegram Bot API reference
(<https://core.telegram.org/bots/api>), because no real sample of the answers was available when the Telegram chat
step of the setup wizard was built (decision 0016, Product Manager's decision). All ids, names, usernames and
dates are invented.

| File                                  | Follows (sections of the reference)                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get-me.json`                         | _Making requests_ (`ok`, `result`), _getMe_, _User_: a bot user with the fields `getMe` adds (`can_join_groups`, `can_read_all_group_messages`, `supports_inline_queries`, `can_connect_to_business`, `has_main_web_app`), status 200                                        |
| `get-updates.json`                    | _Making requests_ (`ok`, `result`), _getUpdates_, _Update_, _Message_, _Chat_, _User_, _ChatMemberUpdated_, _ChatMember_: the oldest update comes first; a private chat after `/start`, groups, a supergroup, an edited message, removed and blocked chats, a migrated group |
| `get-updates-unauthorized.json`       | _Making requests_ (an unsuccessful answer: `ok` false, `error_code`, `description`), status 401                                                                                                                                                                              |
| `get-updates-conflict.json`           | the same error shape, status 409 (a webhook is set)                                                                                                                                                                                                                          |
| `send-message.json`                   | _sendMessage_ (`ok` true, `result` is the sent _Message_)                                                                                                                                                                                                                    |
| `send-message-too-many-requests.json` | _Making requests_ (an unsuccessful answer), _ResponseParameters_ (`retry_after`), status 429                                                                                                                                                                                 |

Because they share the reference's assumptions, tests built on them cannot catch a deviation of the real API from
the reference. Replace them with captured answers (secrets and personal data removed) once a live run yields some;
a deviation found by the live check is a new issue, not a silent edit of these files.
