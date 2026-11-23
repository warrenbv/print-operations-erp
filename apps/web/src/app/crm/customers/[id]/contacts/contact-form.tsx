// The contact fields shared by the add and edit forms. Tags show only on an existing contact.
import { CONTACT_ROLES, type Contact } from '@erp/types';
import { COLOR, CheckboxLabel, Field, FieldLabel, FieldRow, Hint, Input, SPACE } from '@erp/ui';
import { Fragment } from 'react';

import { CONTACT_ROLE_LABELS, CONTACT_ROLES_HINT } from '../../../../../lib/contact-roles';
import { SHARED_MAILBOX_HINT } from '../../../../../lib/helptext';
import { CONTACT_ROLES_FIELD } from './collect-contact';

export function ContactFormFields({ contact }: { contact?: Contact }) {
  const held = new Set(contact?.roles.map((assignment) => assignment.role) ?? []);
  return (
    <Fragment>
      <FieldRow>
        <Field>
          <FieldLabel>Name</FieldLabel>

          <Input
            type="text"
            name="name"
            maxLength={255}
            defaultValue={contact?.name ?? ''}
            style={{ width: 200 }}
          />
          <Hint>{SHARED_MAILBOX_HINT}</Hint>
        </Field>

        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            type="email"
            name="email"
            defaultValue={contact?.email ?? ''}
            style={{ width: 220 }}
          />
        </Field>

        <Field>
          <FieldLabel>Phone</FieldLabel>
          <Input
            type="text"
            name="phone"
            maxLength={64}
            placeholder="(208) 555-0134"
            defaultValue={contact?.phone ?? ''}
            style={{ width: 160 }}
          />
        </Field>
      </FieldRow>

      {contact !== undefined && (
        <fieldset
          style={{
            border: 'none',
            padding: 0,
            marginTop: SPACE.lg,
            display: 'flex',
            gap: SPACE.lg,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <legend
            style={{ padding: 0, marginBottom: SPACE.xs, fontSize: '0.85rem', color: COLOR.muted }}
          >
            Tags
          </legend>
          {CONTACT_ROLES.map((role) => (
            <CheckboxLabel key={role}>
              <input
                type="checkbox"
                name={CONTACT_ROLES_FIELD}
                value={role}
                defaultChecked={held.has(role)}
              />
              {CONTACT_ROLE_LABELS[role]}
            </CheckboxLabel>
          ))}
          <Hint>{CONTACT_ROLES_HINT}</Hint>
        </fieldset>
      )}
    </Fragment>
  );
}
