import { MESSAGE_TEXTS } from "../i18n/messages";
import type { Rule } from "./rule";
import { firstText, securityAlert, stringAt } from "./security-alert";

const REPORTED_ACTIONS: ReadonlySet<string> = new Set(["created", "reopened"]);

/**
 * Reports a new or reopened secret scanning alert, whatever its source. Reads only `alert.number`,
 * `alert.html_url`, `alert.secret_type`, `alert.secret_type_display_name` and `repository.full_name`: never the
 * secret, a resolution comment or a location (decision 0028).
 */
export const SECRET_SCANNING_ALERT: Rule = {
  id: "secret_scanning_alert",
  evaluate: (event, payload, settings) => {
    const fields = securityAlert(event, payload, "secret_scanning_alert", REPORTED_ACTIONS);
    if (fields === undefined) {
      return undefined;
    }
    const secretType = stringAt(fields.alert, ["secret_type"]);
    if (secretType === undefined) {
      return undefined;
    }
    return {
      title: MESSAGE_TEXTS[settings.language].secretScanningAlert,
      repository: fields.repository,
      number: fields.number,
      subject: firstText([stringAt(fields.alert, ["secret_type_display_name"])]) ?? "",
      context: firstText([secretType]) ?? "",
      url: fields.url,
    };
  },
};
