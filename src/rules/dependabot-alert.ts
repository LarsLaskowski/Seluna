import { MESSAGE_TEXTS } from "../i18n/messages";
import { recordField } from "./pull-request";
import type { Rule } from "./rule";
import { firstText, joinContext, securityAlert, stringAt } from "./security-alert";

const REPORTED_ACTIONS: ReadonlySet<string> = new Set(["created", "reopened"]);

/** Reports a new or reopened Dependabot alert. */
export const DEPENDABOT_ALERT: Rule = {
  id: "dependabot_alert",
  evaluate: (event, payload, settings) => {
    const fields = securityAlert(event, payload, "dependabot_alert", REPORTED_ACTIONS);
    if (fields === undefined) {
      return undefined;
    }
    const advisory = recordField(fields.alert, "security_advisory");
    if (advisory === undefined) {
      return undefined;
    }
    const severity = firstText([
      stringAt(advisory, ["severity"]),
      stringAt(fields.alert, ["security_vulnerability", "severity"]),
    ]);
    const packageName = firstText([
      stringAt(fields.alert, ["dependency", "package", "name"]),
      stringAt(fields.alert, ["security_vulnerability", "package", "name"]),
    ]);
    return {
      title: MESSAGE_TEXTS[settings.language].dependabotAlert,
      repository: fields.repository,
      number: fields.number,
      subject: firstText([stringAt(advisory, ["summary"])]) ?? "",
      context: joinContext([severity, packageName]),
      url: fields.url,
    };
  },
};
