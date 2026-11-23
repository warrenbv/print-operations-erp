// One sign-in button per demonstration account, with the task that role performs in the journey.
// The accounts are `DEMO_ROLES` in apps/web/src/lib/portfolio-demo.ts.
import { Button, COLOR, SPACE } from '@erp/ui';
import { DEMO_ROLES } from '../../lib/portfolio-demo';
import { signInDemoAction } from './demo-actions';

export function DemoRoleChoices() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: SPACE.xl,
        marginBottom: SPACE.xxl,
      }}
    >
      {DEMO_ROLES.map((role) => (
        <form
          action={signInDemoAction}
          key={role.key}
          style={{
            border: `1px solid ${COLOR.border}`,
            borderRadius: 6,
            padding: SPACE.xl,
            background: COLOR.surface,
          }}
        >
          <input type="hidden" name="demoRole" value={role.key} />
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>{role.label}</h2>
          <p style={{ lineHeight: 1.5, minHeight: '4.5em' }}>{role.task}</p>
          <Button variant="primary">Try {role.label}</Button>
        </form>
      ))}
    </div>
  );
}
