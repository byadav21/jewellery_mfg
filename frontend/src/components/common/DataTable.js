import React, { useState, useMemo } from 'react';

const DataTable = ({
  columns,
  data,
  pagination,
  onPageChange,
  onLimitChange,
  onSort,
  loading,
  emptyMessage = 'No data found',
  emptyIcon = 'fas fa-inbox',
  selectable = false,
  selectedRows = [],
  onSelectRow,
  onSelectAll,
  rowKey = '_id',
  striped = true,
  hover = true,
  responsive = true,
  className = ''
}) => {
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');

  const handleSort = (column) => {
    if (!column.sortable) return;

    const newDirection = sortColumn === column.key && sortDirection === 'asc' ? 'desc' : 'asc';
    setSortColumn(column.key);
    setSortDirection(newDirection);

    if (onSort) {
      onSort(column.key, newDirection);
    }
  };

  const pageSizes = [10, 25, 50, 100];

  const isAllSelected = data.length > 0 && selectedRows.length === data.length;
  const isSomeSelected = selectedRows.length > 0 && selectedRows.length < data.length;

  // Calculate page numbers to display
  const pageNumbers = useMemo(() => {
    if (!pagination || pagination.pages <= 1) return [];

    const { page, pages } = pagination;
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(pages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    const nums = [];
    for (let i = start; i <= end; i++) {
      nums.push(i);
    }
    return nums;
  }, [pagination]);

  return (
    <div className={`datatable-wrapper ${className}`}>
      {/* Table Info and Page Size */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap">
        <div className="datatable-info text-muted mb-2 mb-md-0">
          {pagination && (
            <span>
              Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
              {pagination.total} entries
            </span>
          )}
        </div>
        <div className="datatable-length">
          <label className="d-flex align-items-center mb-0">
            <span className="mr-2">Show</span>
            <select
              className="form-control form-control-sm"
              value={pagination?.limit || 10}
              onChange={(e) => onLimitChange && onLimitChange(parseInt(e.target.value))}
              style={{ width: 'auto' }}
            >
              {pageSizes.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span className="ml-2">entries</span>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className={responsive ? 'table-responsive' : ''}>
        <table className={`table ${striped ? 'table-striped' : ''} ${hover ? 'table-hover' : ''} table-bordered datatable`}>
          <thead className="thead-light">
            <tr>
              {selectable && (
                <th style={{ width: '40px' }} className="text-center">
                  <div className="custom-control custom-checkbox">
                    <input
                      type="checkbox"
                      className="custom-control-input"
                      id="dt-select-all"
                      checked={isAllSelected}
                      ref={(el) => el && (el.indeterminate = isSomeSelected)}
                      onChange={(e) => onSelectAll && onSelectAll(e.target.checked)}
                    />
                    <label className="custom-control-label" htmlFor="dt-select-all"></label>
                  </div>
                </th>
              )}
              {columns.map((column, index) => (
                <th
                  key={column.key || index}
                  style={{
                    width: column.width,
                    minWidth: column.minWidth,
                    cursor: column.sortable ? 'pointer' : 'default',
                    ...column.headerStyle
                  }}
                  className={`${column.headerClassName || ''} ${column.sortable ? 'sortable' : ''}`}
                  onClick={() => handleSort(column)}
                >
                  <div className="d-flex align-items-center justify-content-between">
                    <span>{column.title}</span>
                    {column.sortable && (
                      <span className="sort-icons ml-1">
                        {sortColumn === column.key ? (
                          sortDirection === 'asc' ? (
                            <i className="fas fa-sort-up text-primary"></i>
                          ) : (
                            <i className="fas fa-sort-down text-primary"></i>
                          )
                        ) : (
                          <i className="fas fa-sort text-muted"></i>
                        )}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="text-center py-5">
                  <div className="spinner-border text-primary" role="status">
                    <span className="sr-only">Loading...</span>
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="text-center py-5 text-muted">
                  <i className={`${emptyIcon} fa-3x mb-3 d-block`}></i>
                  <p className="mb-0">{emptyMessage}</p>
                </td>
              </tr>
            ) : (
              data.map((row, rowIndex) => (
                <tr
                  key={row[rowKey] || rowIndex}
                  className={selectedRows.includes(row[rowKey]) ? 'table-active' : ''}
                >
                  {selectable && (
                    <td className="text-center">
                      <div className="custom-control custom-checkbox">
                        <input
                          type="checkbox"
                          className="custom-control-input"
                          id={`dt-select-${row[rowKey]}`}
                          checked={selectedRows.includes(row[rowKey])}
                          onChange={() => onSelectRow && onSelectRow(row[rowKey])}
                        />
                        <label className="custom-control-label" htmlFor={`dt-select-${row[rowKey]}`}></label>
                      </div>
                    </td>
                  )}
                  {columns.map((column, colIndex) => (
                    <td
                      key={column.key || colIndex}
                      style={column.cellStyle}
                      className={column.cellClassName}
                    >
                      {column.render ? column.render(row[column.key], row, rowIndex) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="d-flex justify-content-between align-items-center mt-3 flex-wrap">
          <div className="datatable-info text-muted mb-2 mb-md-0">
            Page {pagination.page} of {pagination.pages}
          </div>
          <nav>
            <ul className="pagination pagination-sm mb-0">
              {/* First Page */}
              <li className={`page-item ${pagination.page === 1 ? 'disabled' : ''}`}>
                <button
                  className="page-link"
                  onClick={() => onPageChange && onPageChange(1)}
                  disabled={pagination.page === 1}
                  title="First Page"
                >
                  <i className="fas fa-angle-double-left"></i>
                </button>
              </li>

              {/* Previous Page */}
              <li className={`page-item ${pagination.page === 1 ? 'disabled' : ''}`}>
                <button
                  className="page-link"
                  onClick={() => onPageChange && onPageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  title="Previous Page"
                >
                  <i className="fas fa-angle-left"></i>
                </button>
              </li>

              {/* Page Numbers */}
              {pageNumbers[0] > 1 && (
                <>
                  <li className="page-item">
                    <button className="page-link" onClick={() => onPageChange && onPageChange(1)}>1</button>
                  </li>
                  {pageNumbers[0] > 2 && (
                    <li className="page-item disabled">
                      <span className="page-link">...</span>
                    </li>
                  )}
                </>
              )}

              {pageNumbers.map(num => (
                <li key={num} className={`page-item ${pagination.page === num ? 'active' : ''}`}>
                  <button
                    className="page-link"
                    onClick={() => onPageChange && onPageChange(num)}
                  >
                    {num}
                  </button>
                </li>
              ))}

              {pageNumbers[pageNumbers.length - 1] < pagination.pages && (
                <>
                  {pageNumbers[pageNumbers.length - 1] < pagination.pages - 1 && (
                    <li className="page-item disabled">
                      <span className="page-link">...</span>
                    </li>
                  )}
                  <li className="page-item">
                    <button className="page-link" onClick={() => onPageChange && onPageChange(pagination.pages)}>
                      {pagination.pages}
                    </button>
                  </li>
                </>
              )}

              {/* Next Page */}
              <li className={`page-item ${pagination.page === pagination.pages ? 'disabled' : ''}`}>
                <button
                  className="page-link"
                  onClick={() => onPageChange && onPageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.pages}
                  title="Next Page"
                >
                  <i className="fas fa-angle-right"></i>
                </button>
              </li>

              {/* Last Page */}
              <li className={`page-item ${pagination.page === pagination.pages ? 'disabled' : ''}`}>
                <button
                  className="page-link"
                  onClick={() => onPageChange && onPageChange(pagination.pages)}
                  disabled={pagination.page === pagination.pages}
                  title="Last Page"
                >
                  <i className="fas fa-angle-double-right"></i>
                </button>
              </li>
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
};

export default DataTable;
