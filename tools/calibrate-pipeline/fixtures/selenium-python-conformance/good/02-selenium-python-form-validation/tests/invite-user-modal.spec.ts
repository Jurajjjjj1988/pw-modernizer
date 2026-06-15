import { test, expect } from "@fixtures/base.fixture";

/**
 * Migrated from `examples/selenium-python-02-modal-interaction/input.py` —
 * specifically the `test_invite_user_modal_validates_email` pytest scenario
 * (modal form validation). The selenium source located inputs by index
 * (`find_elements(By.CSS_SELECTOR, ".modal input")[0]`) and the submit
 * button by index (`find_elements(By.CSS_SELECTOR, ".modal button")[1]`),
 * slept `time.sleep(1)` after every click, and read the inline error from
 * `.modal .field-error`. The qa-master flow scopes inputs through a single
 * dialog locator (chained `getByRole('dialog')` → `getByLabel('Email')`),
 * uses the visible button name (`Send invite`) instead of an index, and
 * relies on web-first auto-waiting assertions instead of `time.sleep`.
 */
test.describe(
  "Keystone Admin: Invite-user modal validation",
  { tag: ["@desktop", "@keystone-admin", "@invite-modal"] },
  () => {
    test(
      "[QA-401] - Check that an invalid email surfaces an inline validation error",
      {
        annotation: [
          {
            type: "Test",
            description:
              "Submitting `not-an-email` in the invite-user modal renders the inline `Please enter a valid email` error",
          },
        ],
        tag: ["@regression"],
      },
      async ({ usersPage }) => {
        await test.step("Open the users page and trigger the invite modal", async () => {
          await usersPage.open();
          await usersPage.openInviteModal();
          await expect(
            usersPage.dialogInviteUser,
            "Invite-user dialog should be visible after clicking Invite",
          ).toBeVisible();
        });

        await test.step("Submit an invalid email and verify the inline error", async () => {
          await usersPage.submitInvite("not-an-email");
          await expect(
            usersPage.textEmailValidationError,
            "Inline validation error should explain the email format requirement",
          ).toHaveText("Please enter a valid email");
        });

        await test.step("Verify the modal stays open after the validation error", async () => {
          await expect(
            usersPage.dialogInviteUser,
            "Modal should remain open so the user can correct the input",
          ).toBeVisible();
        });
      },
    );
  },
);
