// Fixed internal aliases only: never pass request data to this SQL fragment.
export function badgeColumns(alias = 'u') {
  return `${alias}.is_admin AS staff_badge, EXISTS(SELECT 1 FROM user_badges ub WHERE ub.user_id=${alias}.id AND ub.badge='developer') AS developer_badge`;
}
