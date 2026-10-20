import { MESSAGE_TEXTS } from "../i18n/messages";
import { recordField } from "./pull-request";
import type { Rule } from "./rule";
import { firstText, joinContext, securityAlert, stringAt } from "./security-alert";

const REPORTED_ACTIONS: ReadonlySet<string> = new Set(["created", "reopened", "appeared_in_branch"]);
const BRANCH_REF_PREFIX = "refs/heads/";

/** Reports a new, reopened or newly appeared code scanning alert on the default branch. */
export const CODE_SCANNING_ALERT: Rule = {
  id: "code_scanning_alert",
  evaluate: (event, payload, settings) => {
    const fields = securityAlert(event, payload, "code_scanning_alert", REPORTED_ACTIONS);
    if (fields === undefined) {
      return undefined;
    }
    const rule = recordField(fields.alert, "rule");
    const ref = payload.ref;
    const defaultBranch = stringAt(fields.repositoryRecord, ["default_branch"]);
    if (
      rule === undefined ||
      typeof ref !== "string" ||
      defaultBranch === undefined ||
      defaultBranch === "" ||
      (ref !== `${BRANCH_REF_PREFIX}${defaultBranch}` && ref !== defaultBranch)
    ) {
      return undefined;
    }
    const severity = firstText([stringAt(rule, ["security_severity_level"]), stringAt(rule, ["severity"])]);
    return {
      title: MESSAGE_TEXTS[settings.language].codeScanningAlert,
      repository: fields.repository,
      number: fields.number,
      subject: firstText([stringAt(rule, ["description"])]) ?? "",
      context: joinContext([severity, stringAt(rule, ["id"])]),
      url: fields.url,
    };
  },
};
