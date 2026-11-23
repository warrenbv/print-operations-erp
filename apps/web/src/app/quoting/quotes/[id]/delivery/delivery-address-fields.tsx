// The six delivery address boxes of one line. All six blank means the line is collected.
import { Field, FieldLabel, FieldRow, Hint, Input, SectionNote } from '@erp/ui';

import type { DeliveryDefaults } from '../line-defaults';

const STATE_PATTERN = '[A-Za-z]{2}';
const POSTAL_PATTERN = '[0-9]{5}(-[0-9]{4})?';

export function DeliveryAddressFields({
  index,
  address,
  note = 'Leave all six blank for collection.',
}: {
  index: number;
  address: DeliveryDefaults;
  note?: string;
}) {
  return (
    <>
      <SectionNote>{note}</SectionNote>

      <FieldRow>
        <Field>
          <FieldLabel>Ship-to name</FieldLabel>
          <Input
            type="text"
            name={`lines[${index}].delivery.name`}
            maxLength={120}
            placeholder="Receiving warehouse"
            defaultValue={address.name}
            style={{ width: 240 }}
          />
          <Hint>A site or warehouse, not the legal name.</Hint>
        </Field>

        <Field>
          <FieldLabel>Street</FieldLabel>
          <Input
            type="text"
            name={`lines[${index}].delivery.line1`}
            maxLength={200}
            defaultValue={address.line1}
            style={{ width: 260 }}
          />
        </Field>

        <Field>
          <FieldLabel>Second line</FieldLabel>
          <Input
            type="text"
            name={`lines[${index}].delivery.line2`}
            maxLength={200}
            defaultValue={address.line2}
            style={{ width: 180 }}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field>
          <FieldLabel>City</FieldLabel>
          <Input
            type="text"
            name={`lines[${index}].delivery.city`}
            maxLength={120}
            defaultValue={address.city}
            style={{ width: 200 }}
          />
        </Field>

        <Field>
          <FieldLabel>State</FieldLabel>
          <Input
            type="text"
            name={`lines[${index}].delivery.state`}
            maxLength={2}
            pattern={STATE_PATTERN}
            placeholder="ID"
            defaultValue={address.state}
            style={{ width: 70 }}
          />
        </Field>

        <Field>
          <FieldLabel>ZIP</FieldLabel>
          <Input
            type="text"
            name={`lines[${index}].delivery.postalCode`}
            maxLength={10}
            pattern={POSTAL_PATTERN}
            placeholder="83010"
            defaultValue={address.postalCode}
            style={{ width: 110 }}
          />

          <Hint>ZIP or ZIP+4.</Hint>
        </Field>
      </FieldRow>
    </>
  );
}
