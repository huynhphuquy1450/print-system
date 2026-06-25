import EmptyState from './EmptyState.jsx';
import styles from './DataTable.module.css';

/**
 * @param {{
 *   columns: Array<{key:string, header:string, render?:(val,row)=>React.ReactNode, className?:string}>,
 *   rows: Array<object>,
 *   rowKey: string | ((row:object)=>string),
 *   empty?: React.ReactNode,
 * }} props
 */
export default function DataTable({ columns, rows, rowKey, empty }) {
  const getKey = typeof rowKey === 'function' ? rowKey : (row) => row[rowKey];

  return (
    <div className="table-wrapper">
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.className}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.emptyCell}>
                {empty ?? <EmptyState title="Không có dữ liệu" message="Chưa có bản ghi nào." />}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getKey(row)} className={styles.row}>
                {columns.map((col) => (
                  <td key={col.key} className={col.className}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
